import asyncio
import json
import hashlib

import stripe
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from . import provider
from .schemas import FiscalProfile
from .service import get_fiscal_profile


def stripe_key():
    key = settings.STRIPE_TEST_SECRET_KEY
    if not key.startswith(("sk_test_", "rk_test_")) or key.endswith("..."):
        raise HTTPException(503, "Configura la clave Stripe sandbox en el servidor.")
    return key


async def stripe_call(function, **kwargs):
    try:
        return await asyncio.to_thread(function, api_key=stripe_key(), **kwargs)
    except stripe.StripeError:
        raise HTTPException(503, "No se pudo verificar el pago en Stripe sandbox.") from None


async def subscription_id(db: AsyncSession, user_id: int) -> str | None:
    result = await db.execute(text("SELECT stripe_subscription_id FROM subscriptions WHERE user_id=:uid"), {"uid": user_id})
    return result.scalar_one_or_none()


def validate_payment(invoice: dict, subscription: str):
    parent = invoice.get("parent") or {}
    owner = invoice.get("subscription") or (parent.get("subscription_details") or {}).get("subscription")
    if isinstance(owner, dict):
        owner = owner.get("id")
    if owner != subscription or invoice.get("livemode") is not False:
        raise HTTPException(404, "Pago de prueba no encontrado en tu cuenta.")
    if invoice.get("status") != "paid" or invoice.get("amount_paid", 0) <= 0:
        raise HTTPException(409, "El pago todavía no está confirmado.")


async def list_payments(db: AsyncSession, user_id: int) -> list[dict]:
    sid = await subscription_id(db, user_id)
    if not sid:
        return []
    result = await stripe_call(stripe.Invoice.list, subscription=sid, status="paid", limit=100)
    payments = []
    for invoice in result["data"]:
        validate_payment(invoice, sid)
        payments.append({"id": invoice["id"], "amount_cents": invoice["amount_paid"],
                         "currency": invoice["currency"], "created": invoice["created"]})
    return payments


async def issue(db: AsyncSession, user_id: int, payment_id: str) -> dict:
    provider.test_key()
    sid = await subscription_id(db, user_id)
    if not sid:
        raise HTTPException(404, "No hay una membresía Stripe asociada a tu cuenta.")
    invoice = await stripe_call(stripe.Invoice.retrieve, id=payment_id)
    validate_payment(invoice, sid)
    profile = await get_fiscal_profile(db, user_id)
    if not profile:
        raise HTTPException(409, "Guarda tus datos fiscales antes de solicitar la factura.")
    payload = provider.test_payload(FiscalProfile(**profile), invoice["amount_paid"], invoice["currency"], "bluai-test-" + payment_id)
    return await persist_invoice(db, user_id, payment_id, payload)


async def demo_issue(db: AsyncSession, user_id: int) -> dict:
    provider.test_key()
    profile = await get_fiscal_profile(db, user_id)
    if not profile:
        raise HTTPException(409, "Guarda tus datos fiscales antes de generar el documento de demostración.")
    fingerprint = hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()[:24]
    reference = f"demo_{user_id}_{fingerprint}"
    payload = provider.test_payload(FiscalProfile(**profile), 499, "USD", "bluai-demo-production-" + reference)
    result = await persist_invoice(db, user_id, reference, payload)
    return {**result, "payment_id": None}


async def persist_invoice(db: AsyncSession, user_id: int, payment_id: str, payload: dict) -> dict:
    # Persist the original fiscal snapshot before sending anything externally.
    await db.execute(text("""
        INSERT INTO test_billing_invoices (payment_id, user_id, payload)
        VALUES (:payment, :uid, CAST(:payload AS jsonb))
        ON CONFLICT (payment_id) DO NOTHING
    """), {"payment": payment_id, "uid": user_id, "payload": json.dumps(payload)})
    await db.commit()
    # One invoice per payment, including concurrent browsers and retries.
    result = await db.execute(text("SELECT * FROM test_billing_invoices WHERE payment_id=:payment AND user_id=:uid FOR UPDATE"), {"payment": payment_id, "uid": user_id})
    record = result.mappings().first()
    if not record:
        raise HTTPException(404, "Solicitud no encontrada.")
    try:
        data = await provider.get_invoice(record["provider_id"]) if record["provider_id"] else await provider.create_invoice(record["payload"])
        await db.execute(text("UPDATE test_billing_invoices SET provider_id=:id, status=:status WHERE payment_id=:payment"),
                         {"id": data["id"], "status": data["status"], "payment": payment_id})
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {"id": data["id"], "payment_id": payment_id, "status": data["status"], "mode": "test"}


async def owns_invoice(db: AsyncSession, user_id: int, invoice_id: str):
    result = await db.execute(text("SELECT 1 FROM test_billing_invoices WHERE provider_id=:invoice AND user_id=:uid"), {"invoice": invoice_id, "uid": user_id})
    if not result.first():
        raise HTTPException(404, "Factura no encontrada.")
