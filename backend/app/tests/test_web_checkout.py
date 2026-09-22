from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.payments import web


@pytest.fixture
def setup(monkeypatch):
    for name, value in {
        "WEB_PAYMENTS_ENABLED": True, "WEB_PAYMENTS_ORIGIN": "https://www.bluai.com.mx",
        "STRIPE_SECRET_KEY": "sk_live_fixture", "STRIPE_WEBHOOK_SECRET": "whsec_fixture",
        "STRIPE_PRICE_SAFE_MONTHLY": "price_fixture",
    }.items():
        monkeypatch.setattr(web.settings, name, value)
    db = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = None
    db.execute.return_value = result
    monkeypatch.setattr(web, "get_user_by_firebase_uid", AsyncMock(return_value={"id": 42, "email": "user@example.com"}))
    monkeypatch.setattr(web, "get_subscription", AsyncMock(return_value={"plan_slug": "free", "status": "active"}))
    app = FastAPI()
    app.include_router(web.router)
    app.dependency_overrides[get_current_user] = lambda: {"uid": "firebase-user"}
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app), db, result


@pytest.mark.parametrize("field,value", [("WEB_PAYMENTS_ENABLED", False), ("STRIPE_SECRET_KEY", "sk_test_fixture"), ("STRIPE_WEBHOOK_SECRET", ""), ("WEB_PAYMENTS_ORIGIN", "http://unsafe.test")])
def test_live_configuration_required(setup, monkeypatch, field, value):
    monkeypatch.setattr(web.settings, field, value)
    assert setup[0].get("/web/plans").status_code == 503


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"livemode": False}, {"active": False}, {"unit_amount": 0}, {"currency": "eur"}, {"recurring": {"interval": "week"}}])
async def test_rejects_invalid_live_price(setup, monkeypatch, change):
    price = {"livemode": True, "active": True, "unit_amount": 499, "currency": "usd", "billing_scheme": "per_unit", "recurring": {"interval": "month", "interval_count": 1, "usage_type": "licensed"}, **change}
    monkeypatch.setattr(web, "stripe_call", AsyncMock(return_value=price))
    with pytest.raises(HTTPException) as error:
        await web.live_price("safe", "monthly")
    assert error.value.status_code == 503


BODY = {"plan_slug": "safe", "billing_period": "monthly", "price_id": "price_fixture"}


def test_checkout_uses_server_price_identity_and_origin(setup, monkeypatch):
    client, db, _ = setup
    monkeypatch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_fixture"}))
    call = AsyncMock(return_value={"id": "cs_fixture", "url": "https://checkout.stripe.com/example"})
    monkeypatch.setattr(web, "stripe_call", call)
    response = client.post("/web/checkout", json={**BODY, "user_id": 999, "success_url": "https://evil.test"})
    assert response.status_code == 200
    params = call.call_args.kwargs
    assert params["metadata"]["user_id"] == "42"
    assert params["line_items"] == [{"price": "price_fixture", "quantity": 1}]
    assert params["success_url"] == "https://www.bluai.com.mx/membresias?checkout=success"
    assert params["idempotency_key"].startswith("web-checkout-42-")
    assert db.commit.await_count == 2


def test_cancel_pending_subscription_cannot_buy_again(setup, monkeypatch):
    monkeypatch.setattr(web, "get_subscription", AsyncMock(return_value={"plan_slug": "safe", "status": "active", "cancel_at_period_end": True}))
    assert setup[0].post("/web/checkout", json=BODY).status_code == 409


def test_retry_reuses_open_session(setup, monkeypatch):
    client, _, result = setup
    result.mappings.return_value.first.return_value = {"request_id": "key", "session_id": "cs_fixture"}
    monkeypatch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_fixture"}))
    call = AsyncMock(return_value={"status": "open", "url": "https://checkout.stripe.com/existing", "metadata": BODY})
    monkeypatch.setattr(web, "stripe_call", call)
    assert client.post("/web/checkout", json=BODY).json()["checkout_url"].endswith("existing")
    assert call.await_count == 1


def test_price_change_requires_new_consent(setup, monkeypatch):
    monkeypatch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_changed"}))
    assert setup[0].post("/web/checkout", json=BODY).status_code == 409


def test_checkout_requires_authentication():
    app = FastAPI()
    app.include_router(web.router)
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    assert TestClient(app).post("/web/checkout", json=BODY).status_code in (401, 422)


def test_completed_checkout_waits_for_webhook(setup, monkeypatch):
    client, _, result = setup
    result.mappings.return_value.first.return_value = {"request_id": "key", "session_id": "cs_fixture"}
    monkeypatch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_fixture"}))
    call = AsyncMock(side_effect=[{"status": "complete", "subscription": "sub_fixture"}, {"status": "active"}])
    monkeypatch.setattr(web, "stripe_call", call)
    assert client.post("/web/checkout", json=BODY).status_code == 409
    assert call.await_count == 2


def test_open_checkout_cannot_silently_change_plan(setup, monkeypatch):
    client, _, result = setup
    result.mappings.return_value.first.return_value = {"request_id": "key", "session_id": "cs_fixture"}
    monkeypatch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_fixture"}))
    monkeypatch.setattr(web, "stripe_call", AsyncMock(return_value={"status": "open", "metadata": {"plan_slug": "guard", "billing_period": "annual"}}))
    assert client.post("/web/checkout", json=BODY).status_code == 409


def test_lost_response_cannot_outlive_stripe_idempotency(setup):
    from datetime import datetime, timezone, timedelta
    client, _, result = setup
    result.mappings.return_value.first.return_value = {"request_id": "key", "session_id": None, "created_at": datetime.now(timezone.utc) - timedelta(days=2)}
    # Price validation occurs before recovery; no external provider calls here.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(web, "live_price", AsyncMock(return_value={"price_id": "price_fixture"}))
        assert client.post("/web/checkout", json=BODY).status_code == 409


def test_stripe_item_billing_periods():
    from app.features.payments.router import stripe_period_end
    assert stripe_period_end({"items": {"data": [{"current_period_end": 1234}]}}) == 1234
    assert stripe_period_end({"current_period_end": 4567}) == 4567
