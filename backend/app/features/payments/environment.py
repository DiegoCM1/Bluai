"""One environment selection for checkout, webhooks and cancellation."""
from fastapi import HTTPException
from app.core.config import settings


def stripe_payload(value):
    # Stripe 15 objects no longer provide dict.get; older SDKs subclass dict.
    if isinstance(value, dict):
        return value
    return value.to_dict()


def stripe_setting(suffix: str) -> str:
    mode = settings.STRIPE_MODE
    environment = settings.RAILWAY_ENVIRONMENT_NAME.lower()
    if mode not in {"test", "live"} or (environment == "production" and mode != "live") or (environment in {"staging", "dev", "development"} and mode != "test"):
        raise HTTPException(503, "El modo de pago no corresponde a este entorno.")
    prefix = "STRIPE_TEST_" if mode == "test" else "STRIPE_"
    value = getattr(settings, prefix + suffix)
    if suffix == "SECRET_KEY" and value and not value.startswith((f"sk_{mode}_", f"rk_{mode}_")):
        raise HTTPException(503, "La clave de pago no corresponde a este entorno.")
    return value
