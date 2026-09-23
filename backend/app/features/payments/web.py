"""Live website checkout. Prices and return URLs are controlled by the server."""
import asyncio
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from urllib.parse import urlsplit

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid
from .service import get_subscription

router = APIRouter(prefix="/web")


def configuration():
    origin = urlsplit(settings.WEB_PAYMENTS_ORIGIN)
    if (not settings.WEB_PAYMENTS_ENABLED
        or not settings.STRIPE_SECRET_KEY.startswith(("sk_live_", "rk_live_"))
        or not settings.STRIPE_WEBHOOK_SECRET
        or origin.scheme != "https" or not origin.hostname
        or origin.username or origin.password or origin.query or origin.fragment
        or origin.path not in ("", "/")):
        raise HTTPException(503, "Los pagos todavía no están disponibles.")
    return settings.WEB_PAYMENTS_ORIGIN.rstrip("/")


async def stripe_call(function, *args, **kwargs):
    try:
        return await asyncio.to_thread(function, *args, api_key=settings.STRIPE_SECRET_KEY, **kwargs)
    except stripe.StripeError:
        raise HTTPException(503, "No se pudo contactar al servicio de pagos. Intenta nuevamente.")


async def live_price(plan, period):
    price_id = getattr(settings, f"STRIPE_PRICE_{plan.upper()}_{period.upper()}")
    if not price_id:
        raise HTTPException(503, "Este precio todavía no está disponible.")
    price = await stripe_call(stripe.Price.retrieve, price_id)
    recurring = price.get("recurring") or {}
    if (not price.get("livemode") or not price.get("active")
        or price.get("billing_scheme") != "per_unit"
        or not isinstance(price.get("unit_amount"), int) or price["unit_amount"] <= 0
        or recurring.get("interval") != {"monthly": "month", "annual": "year"}[period]
        or recurring.get("interval_count") != 1 or recurring.get("usage_type") != "licensed"
        or price.get("currency") not in {"usd", "mxn"}):
        raise HTTPException(503, "El precio requiere revisión antes de habilitar los pagos.")
    return {"plan_slug": plan, "billing_period": period, "price_id": price_id,
            "amount": price["unit_amount"], "currency": price["currency"]}


@router.get("/plans")
async def plans():
    configuration()
    return await asyncio.gather(*(live_price(plan, period)
        for plan in ("safe", "guard") for period in ("monthly", "annual")))


class WebCheckout(BaseModel):
    plan_slug: Literal["safe", "guard"]
    billing_period: Literal["monthly", "annual"]
    price_id: str


@router.post("/checkout")
async def checkout(body: WebCheckout, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    origin = configuration()
    account = await get_user_by_firebase_uid(db, user["uid"])
    if not account:
        raise HTTPException(404, "Primero inicia sesión en tu cuenta Bluai.")
    uid = int(account["id"])
    # Serialize all web checkouts for this account, including different browsers/plans.
    await db.execute(text("SELECT pg_advisory_xact_lock(81234, CAST(:uid AS integer))"), {"uid": uid})
    subscription = await get_subscription(db, uid)
    if subscription["plan_slug"] in {"safe", "guard"} and subscription["status"] != "canceled":
        raise HTTPException(409, "Ya tienes una suscripción. Revisa su estado antes de contratar otra.")
    price = await live_price(body.plan_slug, body.billing_period)
    if body.price_id != price["price_id"]:
        raise HTTPException(409, "El precio cambió. Actualiza la página antes de continuar.")
    pending = (await db.execute(text("SELECT request_id, session_id, created_at FROM web_checkouts WHERE user_id=:uid"), {"uid": uid})).mappings().first()
    if pending and not pending["session_id"] and pending["created_at"] < datetime.now(timezone.utc) - timedelta(hours=23):
        # Stripe may prune idempotency keys after 24h. Never risk another charge
        # if a lost response still has not been reconciled by an operator.
        raise HTTPException(409, "Tu intento de pago requiere revisión. Contacta al soporte antes de reintentar.")
    if pending and pending["session_id"]:
        session = await stripe_call(stripe.checkout.Session.retrieve, pending["session_id"])
        if session["status"] == "complete":
            previous = await stripe_call(stripe.Subscription.retrieve, session["subscription"])
            if previous["status"] != "canceled":
                raise HTTPException(409, "Tu pago se está procesando. Actualiza el estado de tu membresía.")
        if session["status"] == "open":
            if session.get("metadata", {}).get("plan_slug") != body.plan_slug or session.get("metadata", {}).get("billing_period") != body.billing_period:
                raise HTTPException(409, "Tienes un pago abierto para otro plan o periodo. Continúa con esa selección o espera a que venza.")
            return {"checkout_url": session["url"]}
        pending = None
    request_id = pending["request_id"] if pending else str(uuid4())
    # Persist the idempotency key before contacting Stripe; recover safely after timeouts.
    await db.execute(text("INSERT INTO web_checkouts(user_id, request_id) VALUES (:uid, :key) ON CONFLICT(user_id) DO UPDATE SET created_at=CASE WHEN web_checkouts.request_id=:key THEN web_checkouts.created_at ELSE NOW() END, request_id=:key, session_id=NULL"), {"uid": uid, "key": request_id})
    await db.commit()
    metadata = {"user_id": str(uid), "plan_slug": body.plan_slug, "billing_period": body.billing_period}
    session = await stripe_call(stripe.checkout.Session.create,
        mode="subscription", payment_method_types=["card"],
        line_items=[{"price": price["price_id"], "quantity": 1}],
        client_reference_id=str(uid), customer_email=account.get("email") or None,
        metadata=metadata, subscription_data={"metadata": metadata},
        success_url=f"{origin}/membresias?checkout=success",
        cancel_url=f"{origin}/membresias?checkout=cancelled",
        idempotency_key=f"web-checkout-{uid}-{request_id}")
    await db.execute(text("UPDATE web_checkouts SET session_id=:session WHERE user_id=:uid AND request_id=:key"), {"uid": uid, "key": request_id, "session": session["id"]})
    await db.commit()
    return {"checkout_url": session["url"]}
