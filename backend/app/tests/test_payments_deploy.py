from importlib import import_module
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.auth import get_current_user
from app.core.database import get_db

payments = import_module("app.features.payments.router")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(payments.router)
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: {"uid": "test-user"}
    with TestClient(app) as value:
        yield value


def test_webhook_requires_configured_signature_secret(client, monkeypatch):
    monkeypatch.setattr(payments.settings, "STRIPE_WEBHOOK_SECRET", "")
    assert client.post("/api/v1/payments/webhook/stripe", json={}).status_code == 503


def test_simulation_disabled_outside_dev(client, monkeypatch):
    monkeypatch.setattr(payments.settings, "DEV_BYPASS_MAP_EVENTS_AUTH", False)
    assert client.post("/api/v1/payments/dev/simulate", json={"plan_slug": "guard"}).status_code == 403


def test_active_subscription_prevents_duplicate_checkout(client, monkeypatch):
    monkeypatch.setattr(payments, "get_user_by_firebase_uid", AsyncMock(return_value={"id": 1}))
    monkeypatch.setattr(payments, "get_subscription", AsyncMock(return_value={
        "status": "active", "plan_slug": "safe", "cancel_at_period_end": False,
    }))
    checkout = AsyncMock()
    monkeypatch.setattr(payments, "create_checkout_session", checkout)
    response = client.post("/api/v1/payments/checkout", json={"plan_slug": "guard", "billing_period": "monthly"})
    assert response.status_code == 409
    checkout.assert_not_awaited()


@pytest.mark.parametrize("outcome", ["success", "cancelled"])
def test_checkout_returns_to_mobile_app(client, outcome):
    response = client.get(f"/api/v1/payments/subscription/{outcome}", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == f"blueye://subscription?checkout={outcome}"
