import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid
from .schemas import (
    AddFamilyMemberRequest,
    CheckoutRequest,
    CheckoutResponse,
    FamilyMemberResponse,
    PlanResponse,
    SimulateRequest,
    SubscriptionResponse,
)
from .service import (
    add_family_member,
    claim_subscription_event,
    complete_subscription_event,
    create_checkout_session,
    cancel_stripe_subscription,
    get_plans,
    get_subscription,
    get_subscription_owner_by_stripe_id,
    list_family_members,
    mark_stripe_payment_failed,
    remove_family_member,
    subscription_status,
    upsert_subscription,
)

from .web import router as web_router

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])
router.include_router(web_router)


def stripe_period_end(subscription):
    # New Stripe API versions expose billing periods on subscription items.
    return subscription.get("current_period_end") or min(
        (item["current_period_end"] for item in subscription.get("items", {}).get("data", [])
         if item.get("current_period_end")), default=None,
    )


def checkout_return_url(request: Request, outcome: str) -> str:
    base_url = settings.PAYMENTS_PUBLIC_URL.rstrip("/") or str(request.base_url).rstrip("/")
    return f"{base_url}/api/v1/payments/subscription/{outcome}"


@router.get("/plans", response_model=list[PlanResponse])
async def list_plans():
    return await get_plans()


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_my_subscription(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return await get_subscription(db, int(db_user["id"]))


@router.get("/family-members", response_model=list[FamilyMemberResponse])
async def get_my_family_members(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return await list_family_members(db, int(db_user["id"]))


@router.post("/family-members", response_model=FamilyMemberResponse)
async def create_family_member(
    body: AddFamilyMemberRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        return await add_family_member(db, int(db_user["id"]), body.email)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/family-members/{member_user_id}")
async def delete_family_member(
    member_user_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        await remove_family_member(db, int(db_user["id"]), member_user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"status": "ok"}


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    if body.plan_slug in ("free", "edu"):
        raise HTTPException(status_code=400, detail="This plan is free — no checkout needed.")
    if body.billing_period not in ("monthly", "annual"):
        raise HTTPException(status_code=400, detail="billing_period must be 'monthly' or 'annual'.")

    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    current_subscription = await get_subscription(db, int(db_user["id"]))
    if (
        current_subscription["status"] == "active"
        and current_subscription["plan_slug"] in {"safe", "guard"}
        and not current_subscription["cancel_at_period_end"]
    ):
        raise HTTPException(
            status_code=409,
            detail="An active subscription already exists. Cancel its renewal before creating a new checkout.",
        )

    checkout_url = await create_checkout_session(
        db,
        user_id=int(db_user["id"]),
        plan_slug=body.plan_slug,
        billing_period=body.billing_period,
        user_email=str(db_user.get("email") or ""),
        success_url=checkout_return_url(request, "success"),
        cancel_url=checkout_return_url(request, "cancelled"),
        provider=body.provider,
    )

    if not checkout_url:
        raise HTTPException(
            status_code=503,
            detail="Payment processing unavailable. Configure STRIPE_SECRET_KEY or MP_ACCESS_TOKEN.",
        )

    return {"checkout_url": checkout_url}


@router.get("/subscription/success", include_in_schema=False)
async def checkout_success():
    return RedirectResponse("blueye://subscription?checkout=success", status_code=303)


@router.get("/subscription/cancelled", include_in_schema=False)
async def checkout_cancelled():
    return RedirectResponse("blueye://subscription?checkout=cancelled", status_code=303)


# ── Dev-only: simulate a subscription without payment ──────────────────────────
@router.post("/dev/simulate", response_model=SubscriptionResponse)
async def dev_simulate_subscription(
    body: SimulateRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    if not settings.DEV_BYPASS_MAP_EVENTS_AUTH:
        raise HTTPException(status_code=403, detail="Only available in dev environments.")

    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    return await upsert_subscription(db, int(db_user["id"]), body.plan_slug, body.billing_period)


@router.post("/subscription/cancel", response_model=SubscriptionResponse)
async def cancel_my_subscription(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        return await cancel_stripe_subscription(db, int(db_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Stripe webhook ─────────────────────────────────────────────────────────────
@router.post("/webhook/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    webhook_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", "")

    if not webhook_secret:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET is not configured.")

    try:
        import stripe  # type: ignore
        stripe.api_key = settings.STRIPE_SECRET_KEY
        event = stripe.Webhook.construct_event(payload, sig, webhook_secret)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    event_id = str(event.get("id") or "")
    if not event_id:
        raise HTTPException(status_code=400, detail="Stripe event ID is missing.")
    event_type = str(event["type"])
    event_data = event["data"]["object"]
    event_meta = event_data.get("metadata", {})
    stripe_subscription_id = str(event_data.get("subscription") or event_data.get("id") or "")
    event_user_id = event_meta.get("user_id")
    if not event_user_id and stripe_subscription_id:
        event_user_id = await get_subscription_owner_by_stripe_id(db, stripe_subscription_id)
    if not await claim_subscription_event(
        db,
        provider="stripe",
        provider_event_id=event_id,
        event_type=event_type,
        user_id=int(event_user_id) if event_user_id else None,
        plan_slug=event_meta.get("plan_slug"),
        billing_period=event_meta.get("billing_period"),
        amount_cents=event_data.get("amount_paid") or event_data.get("amount_due"),
        currency=event_data.get("currency"),
        details={"livemode": bool(event.get("livemode"))},
    ):
        return {"status": "duplicate"}

    try:
        if event_type == "checkout.session.completed":
            session = event["data"]["object"]
            meta = session.get("metadata", {})
            user_id = meta.get("user_id")
            plan_slug = meta.get("plan_slug")
            billing_period = meta.get("billing_period", "monthly")

            stripe_subscription_id = session.get("subscription")
            if user_id and plan_slug and stripe_subscription_id:
                stripe_subscription = await asyncio.to_thread(stripe.Subscription.retrieve, stripe_subscription_id)
                period_end = stripe_period_end(stripe_subscription)
                await upsert_subscription(
                    db, int(user_id), plan_slug, billing_period,
                    current_period_end=datetime.fromtimestamp(period_end, timezone.utc) if period_end else None,
                    payment_provider="stripe", stripe_customer_id=str(stripe_subscription.get("customer") or "") or None,
                    stripe_subscription_id=str(stripe_subscription_id),
                    status=subscription_status(str(stripe_subscription.get("status") or "")),
                    cancel_at_period_end=bool(stripe_subscription.get("cancel_at_period_end")),
                )

        if event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
            stripe_subscription = event["data"]["object"]
            meta = stripe_subscription.get("metadata", {})
            user_id = meta.get("user_id")
            plan_slug = meta.get("plan_slug")
            billing_period = meta.get("billing_period", "monthly")
            period_end = stripe_period_end(stripe_subscription)
            if user_id and plan_slug:
                await upsert_subscription(
                    db, int(user_id), plan_slug, billing_period,
                    current_period_end=datetime.fromtimestamp(period_end, timezone.utc) if period_end else None,
                    payment_provider="stripe", stripe_customer_id=str(stripe_subscription.get("customer") or "") or None,
                    stripe_subscription_id=str(stripe_subscription.get("id") or "") or None,
                    status=subscription_status(str(stripe_subscription.get("status") or "")),
                    cancel_at_period_end=bool(stripe_subscription.get("cancel_at_period_end")),
                )

        if event_type == "invoice.payment_failed" and stripe_subscription_id:
            await mark_stripe_payment_failed(db, stripe_subscription_id)
    except Exception:
        await complete_subscription_event(db, event_id, succeeded=False)
        raise

    await complete_subscription_event(db, event_id, succeeded=True)

    return {"status": "ok"}


# ── MercadoPago webhook ────────────────────────────────────────────────────────
@router.post("/webhook/mercadopago")
async def mp_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    data = await request.json()
    if data.get("type") != "payment":
        return {"status": "ignored"}

    try:
        import mercadopago  # type: ignore
        sdk = mercadopago.SDK(settings.MP_ACCESS_TOKEN)
        payment_id = data["data"]["id"]
        payment = sdk.payment().get(payment_id)["response"]

        if payment.get("status") != "approved":
            return {"status": "not_approved"}

        external_ref = payment.get("external_reference", "")
        parts = external_ref.split(":")
        if len(parts) != 3:
            return {"status": "bad_reference"}

        user_id, plan_slug, billing_period = parts
        await upsert_subscription(
            db,
            int(user_id),
            plan_slug,
            billing_period,
            payment_provider="mercadopago",
        )
    except Exception:
        pass

    return {"status": "ok"}
