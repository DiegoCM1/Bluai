from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from math import asin, cos, radians, sin, sqrt
import logging
import json
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

PLANS = [
    {
        "slug": "free",
        "name": "Bluai",
        "description": "Protección básica para ti",
        "monthly_price": None,
        "annual_price": None,
        "annual_discount": 0,
        "features": [
            "IA Empática Offline",
            "Mapa de Riesgos y Apoyo",
            "Alertas SIAT-CT Oficiales",
        ],
        "is_free": True,
    },
    {
        "slug": "safe",
        "name": "Bluai Safe",
        "description": "Para familias que quieren estar siempre conectadas",
        "monthly_price": 4.99,
        "annual_price": 49.90,
        "annual_discount": 17,
        "features": [
            "Todo el plan Gratuito",
            "Geolocalización de Familiares",
            "Botón de Pánico",
        ],
        "is_free": False,
    },
    {
        "slug": "guard",
        "name": "Blu Guard",
        "description": "Gestión de equipos y personal crítico",
        "monthly_price": 9.99,
        "annual_price": 99.90,
        "annual_discount": 17,
        "features": [
            "Todo el plan Safe",
            "Gestión de Personal Crítico",
            "Dashboard Predictivo Centralizado",
            "Comunicación Ininterrumpida",
        ],
        "is_free": False,
    },
    {
        "slug": "edu",
        "name": "Blu Edu",
        "description": "Para instituciones educativas",
        "monthly_price": None,
        "annual_price": None,
        "annual_discount": 0,
        "features": [
            "Todo el plan Gratuito",
            "Geolocalización",
            "Botón de Pánico",
            "Módulos de Resiliencia",
        ],
        "is_free": True,
    },
]


async def get_plans() -> list[dict]:
    return PLANS


def _serialize_period_end(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def subscription_status(provider_status: str) -> str:
    if provider_status == "canceled":
        return "canceled"
    return "active" if provider_status in {"active", "trialing"} else "inactive"


async def claim_subscription_event(
    db: AsyncSession,
    *,
    provider: str,
    provider_event_id: str,
    event_type: str,
    user_id: int | None = None,
    plan_slug: str | None = None,
    billing_period: str | None = None,
    amount_cents: int | None = None,
    currency: str | None = None,
    details: dict | None = None,
) -> bool:
    """Claim a provider event once; completed events are safe to ignore on retry."""
    result = await db.execute(
        text("""
            INSERT INTO subscription_events (
                user_id, provider, event_type, provider_event_id, plan_slug,
                billing_period, amount_cents, currency, details
            )
            VALUES (
                :user_id, :provider, :event_type, :provider_event_id, :plan_slug,
                :billing_period, :amount_cents, :currency, CAST(:details AS jsonb)
            )
            ON CONFLICT (provider_event_id) DO UPDATE
            SET processing_status = 'processing',
                event_type = EXCLUDED.event_type,
                details = EXCLUDED.details
            WHERE subscription_events.processing_status <> 'processed'
            RETURNING id
        """),
        {
            "user_id": user_id,
            "provider": provider,
            "event_type": event_type,
            "provider_event_id": provider_event_id,
            "plan_slug": plan_slug,
            "billing_period": billing_period,
            "amount_cents": amount_cents,
            "currency": currency,
            "details": json.dumps(details or {}),
        },
    )
    claimed = result.fetchone() is not None
    await db.commit()
    return claimed


async def complete_subscription_event(
    db: AsyncSession,
    provider_event_id: str,
    *,
    succeeded: bool,
) -> None:
    await db.execute(
        text("""
            UPDATE subscription_events
            SET processing_status = :status,
                processed_at = CASE WHEN :succeeded THEN NOW() ELSE NULL END
            WHERE provider_event_id = :provider_event_id
        """),
        {
            "provider_event_id": provider_event_id,
            "status": "processed" if succeeded else "failed",
            "succeeded": succeeded,
        },
    )
    await db.commit()


async def get_subscription_owner_by_stripe_id(db: AsyncSession, stripe_subscription_id: str) -> int | None:
    result = await db.execute(
        text("SELECT user_id FROM subscriptions WHERE stripe_subscription_id = :subscription_id"),
        {"subscription_id": stripe_subscription_id},
    )
    row = result.fetchone()
    return int(row.user_id) if row else None


async def mark_stripe_payment_failed(db: AsyncSession, stripe_subscription_id: str) -> None:
    await db.execute(
        text("""
            UPDATE subscriptions
            SET status = 'inactive', updated_at = NOW()
            WHERE stripe_subscription_id = :subscription_id
        """),
        {"subscription_id": stripe_subscription_id},
    )
    await db.commit()


async def record_subscription_event(
    db: AsyncSession,
    *,
    user_id: int,
    provider: str,
    event_type: str,
    plan_slug: str | None = None,
    billing_period: str | None = None,
    details: dict | None = None,
) -> None:
    await db.execute(
        text("""
            INSERT INTO subscription_events (
                user_id, provider, event_type, processing_status, plan_slug,
                billing_period, details, processed_at
            )
            VALUES (
                :user_id, :provider, :event_type, 'processed', :plan_slug,
                :billing_period, CAST(:details AS jsonb), NOW()
            )
        """),
        {
            "user_id": user_id,
            "provider": provider,
            "event_type": event_type,
            "plan_slug": plan_slug,
            "billing_period": billing_period,
            "details": json.dumps(details or {}),
        },
    )
    await db.commit()


async def upsert_subscription(
    db: AsyncSession,
    user_id: int,
    plan_slug: str,
    billing_period: str = "monthly",
    *,
    current_period_end: datetime | None = None,
    payment_provider: str | None = None,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    status: str = "active",
    cancel_at_period_end: bool = False,
) -> dict:
    period_end = current_period_end or datetime.now(timezone.utc) + timedelta(
        days=365 if billing_period == "annual" else 30
    )
    await db.execute(
        text("""
            INSERT INTO subscriptions (
                user_id, plan_slug, status, billing_period, current_period_end,
                payment_provider, stripe_customer_id, stripe_subscription_id,
                cancel_at_period_end, updated_at
            )
            VALUES (
                :uid, :plan, :status, :period, :end,
                :provider, :stripe_customer_id, :stripe_subscription_id,
                :cancel_at_period_end, NOW()
            )
            ON CONFLICT (user_id) DO UPDATE
              SET plan_slug = EXCLUDED.plan_slug,
                  status = EXCLUDED.status,
                  billing_period = EXCLUDED.billing_period,
                  current_period_end = EXCLUDED.current_period_end,
                  payment_provider = COALESCE(EXCLUDED.payment_provider, subscriptions.payment_provider),
                  stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
                  stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
                  cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                  updated_at = NOW()
        """),
        {
            "uid": user_id,
            "plan": plan_slug,
            "status": status,
            "period": billing_period,
            "end": period_end,
            "provider": payment_provider,
            "stripe_customer_id": stripe_customer_id,
            "stripe_subscription_id": stripe_subscription_id,
            "cancel_at_period_end": cancel_at_period_end,
        },
    )
    await db.commit()
    await record_subscription_event(
        db,
        user_id=user_id,
        provider=payment_provider or "internal",
        event_type="subscription.synced",
        plan_slug=plan_slug,
        billing_period=billing_period,
        details={"status": status, "cancel_at_period_end": cancel_at_period_end},
    )
    return {
        "plan_slug": plan_slug,
        "status": status,
        "current_period_end": _serialize_period_end(period_end),
        "billing_period": billing_period,
        "payment_provider": payment_provider,
        "cancel_at_period_end": cancel_at_period_end,
    }


async def get_subscription(db: AsyncSession, user_id: int) -> dict:
    result = await db.execute(
        text("""
            SELECT plan_slug, status, billing_period, current_period_end,
                   payment_provider, cancel_at_period_end
            FROM subscriptions
            WHERE user_id = :uid
        """),
        {"uid": user_id},
    )
    row = result.fetchone()
    if not row:
        return {
            "plan_slug": "free",
            "status": "active",
            "current_period_end": None,
            "billing_period": "monthly",
            "payment_provider": None,
            "cancel_at_period_end": False,
        }
    return {
        "plan_slug": row.plan_slug,
        "status": row.status,
        "current_period_end": _serialize_period_end(row.current_period_end),
        "billing_period": row.billing_period,
        "payment_provider": row.payment_provider,
        "cancel_at_period_end": row.cancel_at_period_end,
    }


async def cancel_stripe_subscription(db: AsyncSession, user_id: int) -> dict:
    result = await db.execute(
        text("""
            SELECT stripe_subscription_id
            FROM subscriptions
            WHERE user_id = :uid AND payment_provider = 'stripe'
        """),
        {"uid": user_id},
    )
    row = result.fetchone()
    if not row or not row.stripe_subscription_id:
        raise ValueError("No active Stripe subscription was found.")

    from app.core.config import settings
    import stripe  # type: ignore

    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("Stripe is not configured.")

    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.Subscription.modify(row.stripe_subscription_id, cancel_at_period_end=True)
    await db.execute(
        text("""
            UPDATE subscriptions
            SET cancel_at_period_end = TRUE, updated_at = NOW()
            WHERE user_id = :uid
        """),
        {"uid": user_id},
    )
    await db.commit()
    await record_subscription_event(
        db,
        user_id=user_id,
        provider="stripe",
        event_type="subscription.cancel_requested",
        details={"stripe_subscription_id": row.stripe_subscription_id},
    )
    return await get_subscription(db, user_id)


_PLAN_PRICES = {
    ("safe", "monthly"): ("Bluai Safe — Mensual",  4.99),
    ("safe", "annual"):  ("Bluai Safe — Anual",    49.90),
    ("guard", "monthly"): ("Blu Guard — Mensual",  9.99),
    ("guard", "annual"):  ("Blu Guard — Anual",    99.90),
}


async def _create_stripe_session(
    plan_slug: str,
    billing_period: str,
    user_email: str,
    success_url: str,
    cancel_url: str,
    user_id: int,
) -> Optional[str]:
    from app.core.config import settings
    import stripe  # type: ignore

    stripe_key = getattr(settings, "STRIPE_SECRET_KEY", "")
    if not stripe_key:
        return None

    try:
        stripe.api_key = stripe_key

        inline_prices = {
            ("safe", "monthly"): {"currency": "usd", "unit_amount": 499,  "recurring": {"interval": "month"}, "product_data": {"name": "Bluai Safe — Mensual"}},
            ("safe", "annual"):  {"currency": "usd", "unit_amount": 4990, "recurring": {"interval": "year"},  "product_data": {"name": "Bluai Safe — Anual"}},
            ("guard", "monthly"): {"currency": "usd", "unit_amount": 999,  "recurring": {"interval": "month"}, "product_data": {"name": "Blu Guard — Mensual"}},
            ("guard", "annual"):  {"currency": "usd", "unit_amount": 9990, "recurring": {"interval": "year"},  "product_data": {"name": "Blu Guard — Anual"}},
        }

        price_id = getattr(settings, f"STRIPE_PRICE_{plan_slug.upper()}_{billing_period.upper()}", "")
        if price_id:
            line_items = [{"price": price_id, "quantity": 1}]
        else:
            price_data = inline_prices.get((plan_slug, billing_period))
            if not price_data:
                return None
            line_items = [{"price_data": price_data, "quantity": 1}]

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=line_items,
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=user_email or None,
            metadata={"user_id": str(user_id), "plan_slug": plan_slug, "billing_period": billing_period},
            subscription_data={"metadata": {"user_id": str(user_id), "plan_slug": plan_slug, "billing_period": billing_period}},
        )
        return session.url
    except Exception as exc:
        logger.exception("Stripe session creation failed: %s", exc)
        return None


async def _create_mp_session(
    plan_slug: str,
    billing_period: str,
    user_email: str,
    success_url: str,
    cancel_url: str,
    user_id: int,
) -> Optional[str]:
    from app.core.config import settings

    access_token = getattr(settings, "MP_ACCESS_TOKEN", "")
    if not access_token:
        return None

    try:
        import mercadopago  # type: ignore

        sdk = mercadopago.SDK(access_token)
        item_data = _PLAN_PRICES.get((plan_slug, billing_period))
        if not item_data:
            return None

        title, price = item_data
        preference_data = {
            "items": [{"title": title, "quantity": 1, "unit_price": price, "currency_id": "USD"}],
            "payer": {"email": user_email or ""},
            "back_urls": {"success": success_url, "failure": cancel_url, "pending": success_url},
            "auto_return": "approved",
            "external_reference": f"{user_id}:{plan_slug}:{billing_period}",
        }

        result = sdk.preference().create(preference_data)
        preference = result.get("response", {})
        is_sandbox = access_token.startswith("TEST-")
        return preference.get("sandbox_init_point" if is_sandbox else "init_point")
    except Exception:
        return None


async def create_checkout_session(
    db: AsyncSession,
    user_id: int,
    plan_slug: str,
    billing_period: str,
    user_email: str,
    success_url: str,
    cancel_url: str,
    provider: str = "auto",
) -> Optional[str]:
    if provider == "mercadopago":
        return await _create_mp_session(plan_slug, billing_period, user_email, success_url, cancel_url, user_id)
    if provider == "stripe":
        return await _create_stripe_session(plan_slug, billing_period, user_email, success_url, cancel_url, user_id)
    # auto: prefer stripe, fallback to mercadopago
    url = await _create_stripe_session(plan_slug, billing_period, user_email, success_url, cancel_url, user_id)
    if not url:
        url = await _create_mp_session(plan_slug, billing_period, user_email, success_url, cancel_url, user_id)
    return url


def _distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * radius * asin(sqrt(a))


def _avatar_color(seed: int) -> str:
    palette = ["#60A5FA", "#34D399", "#F59E0B", "#F472B6", "#A78BFA", "#F87171"]
    return palette[seed % len(palette)]


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "NA"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


async def list_family_members(db: AsyncSession, owner_user_id: int) -> list[dict]:
    result = await db.execute(
        text(
            """
            SELECT
                fm.member_user_id,
                u.display_name,
                u.email,
                u.lat,
                u.lon,
                u.updated_at,
                owner.lat AS owner_lat,
                owner.lon AS owner_lon
            FROM family_members fm
            JOIN users u ON u.id = fm.member_user_id
            JOIN users owner ON owner.id = fm.owner_user_id
            WHERE fm.owner_user_id = :owner_user_id
            ORDER BY COALESCE(u.display_name, u.email, u.firebase_uid)
            """
        ),
        {"owner_user_id": owner_user_id},
    )
    rows = result.mappings().all()
    members: list[dict] = []
    for idx, row in enumerate(rows):
        name = str(row["display_name"] or row["email"] or f"Usuario {row['member_user_id']}")
        distance = 0.0
        unit = "mts"
        if all(row.get(k) is not None for k in ("owner_lat", "owner_lon", "lat", "lon")):
            meters = _distance_meters(float(row["owner_lat"]), float(row["owner_lon"]), float(row["lat"]), float(row["lon"]))
            if meters >= 1000:
                distance = round(meters / 1000, 1)
                unit = "km"
            else:
                distance = round(meters)
        members.append(
            {
                "id": str(row["member_user_id"]),
                "name": name,
                "initials": _initials(name),
                "distance": distance,
                "distance_unit": unit,
                "last_updated": row["updated_at"].isoformat() if row["updated_at"] else None,
                "avatar_color": _avatar_color(idx),
                "email": row["email"],
            }
        )
    return members


async def add_family_member(db: AsyncSession, owner_user_id: int, member_email: str) -> dict:
    normalized_email = member_email.strip().lower()
    if not normalized_email:
        raise ValueError("Email is required.")

    owner_sub = await get_subscription(db, owner_user_id)
    if owner_sub["plan_slug"] not in {"safe", "guard"} or owner_sub["status"] != "active":
        raise PermissionError("An active family-capable plan is required.")

    owner_result = await db.execute(
        text("SELECT email FROM users WHERE id = :uid"),
        {"uid": owner_user_id},
    )
    owner_row = owner_result.mappings().first()
    if owner_row and str(owner_row.get("email") or "").lower() == normalized_email:
        raise ValueError("You cannot add yourself as a family member.")

    member_result = await db.execute(
        text(
            """
            SELECT id
            FROM users
            WHERE LOWER(email) = :email
            LIMIT 1
            """
        ),
        {"email": normalized_email},
    )
    member_row = member_result.mappings().first()
    if not member_row:
        raise LookupError("No user with that email was found.")

    member_user_id = int(member_row["id"])
    existing = await db.execute(
        text(
            """
            SELECT 1
            FROM family_members
            WHERE owner_user_id = :owner_user_id
              AND member_user_id = :member_user_id
            """
        ),
        {"owner_user_id": owner_user_id, "member_user_id": member_user_id},
    )
    if existing.first():
        raise ValueError("That user is already in your family plan.")

    count_result = await db.execute(
        text("SELECT COUNT(*) FROM family_members WHERE owner_user_id = :owner_user_id"),
        {"owner_user_id": owner_user_id},
    )
    current_count = int(count_result.scalar_one())
    max_members = 4 if owner_sub["plan_slug"] == "guard" else 3
    if current_count >= max_members:
        raise ValueError(f"Your current plan supports up to {max_members} family members.")

    await db.execute(
        text(
            """
            INSERT INTO family_members (owner_user_id, member_user_id)
            VALUES (:owner_user_id, :member_user_id)
            ON CONFLICT DO NOTHING
            """
        ),
        {"owner_user_id": owner_user_id, "member_user_id": member_user_id},
    )
    await db.commit()
    members = await list_family_members(db, owner_user_id)
    for member in members:
        if member["id"] == str(member_user_id):
            return member
    raise LookupError("Family member was added but could not be reloaded.")


async def remove_family_member(db: AsyncSession, owner_user_id: int, member_user_id: int) -> None:
    result = await db.execute(
        text(
            """
            DELETE FROM family_members
            WHERE owner_user_id = :owner_user_id
              AND member_user_id = :member_user_id
            """
        ),
        {"owner_user_id": owner_user_id, "member_user_id": member_user_id},
    )
    await db.commit()
    if result.rowcount == 0:
        raise LookupError("Family member not found.")
