"""API contract journey; Stripe transport and persistence are mocked, not a sandbox demo."""
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.config import settings
from app.features.payments import router as payments, web


def test_free_checkout_signed_webhook_paid_and_return(monkeypatch):
    for key, value in {'STRIPE_MODE': 'test', 'RAILWAY_ENVIRONMENT_NAME': 'staging',
        'STRIPE_TEST_SECRET_KEY': 'sk_test_fixture', 'STRIPE_TEST_WEBHOOK_SECRET': 'whsec_fixture',
        'WEB_PAYMENTS_ENABLED': True, 'WEB_PAYMENTS_ORIGIN': 'https://dev.example.com'}.items():
        monkeypatch.setattr(settings, key, value)
    state = {'plan_slug': 'free', 'status': 'active', 'current_period_end': None,
             'billing_period': 'monthly', 'payment_provider': None, 'cancel_at_period_end': False}
    async def subscription(*args): return dict(state)
    async def update(db, uid, plan, period, **kwargs):
        assert uid == 42
        state.update(plan_slug=plan, billing_period=period, status=kwargs['status'], payment_provider='stripe')
    for module in (payments, web):
        monkeypatch.setattr(module, 'get_user_by_firebase_uid', AsyncMock(return_value={'id': 42}))
        monkeypatch.setattr(module, 'get_subscription', subscription)
    monkeypatch.setattr(payments, 'upsert_subscription', update)
    monkeypatch.setattr(payments, 'claim_subscription_event', AsyncMock(return_value=True))
    monkeypatch.setattr(payments, 'complete_subscription_event', AsyncMock())
    monkeypatch.setattr(web, 'live_price', AsyncMock(return_value={'price_id': 'price_fixture'}))
    monkeypatch.setattr(web, 'stripe_call', AsyncMock(return_value={'id': 'cs_fixture', 'url': 'https://checkout.stripe.com/fixture'}))
    monkeypatch.setattr('stripe.Subscription.retrieve', lambda *args, **kwargs: {'status': 'active', 'items': {'data': [{'current_period_end': int(time.time()) + 3600}]}})
    db = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = None
    db.execute.return_value = result
    app = FastAPI()
    app.include_router(payments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {'uid': 'fixture'}
    client = TestClient(app)
    base = '/api/v1/payments'
    assert client.get(base + '/subscription').json()['plan_slug'] == 'free'
    assert client.get(base + '/web/config').json()['membership_url'] == 'https://dev.example.com/membresias'
    assert client.post(base + '/web/checkout', json={'plan_slug': 'safe', 'billing_period': 'monthly', 'price_id': 'price_fixture'}).status_code == 200
    assert client.get(base + '/subscription').json()['plan_slug'] == 'free'
    event = {'object': 'event', 'id': 'evt_fixture', 'livemode': False, 'type': 'checkout.session.completed',
             'data': {'object': {'object': 'checkout.session', 'subscription': 'sub_fixture', 'metadata': {'user_id': '42', 'plan_slug': 'safe', 'billing_period': 'monthly'}}}}
    payload = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(b'whsec_fixture', timestamp.encode() + b'.' + payload, hashlib.sha256).hexdigest()
    assert client.post(base + '/webhook/stripe', content=payload, headers={'stripe-signature': 'invalid'}).status_code == 400
    assert state['plan_slug'] == 'free'
    response = client.post(base + '/webhook/stripe', content=payload, headers={'stripe-signature': f't={timestamp},v1={signature}'})
    assert response.status_code == 200, response.text
    assert client.get(base + '/subscription').json()['plan_slug'] == 'safe'
    assert client.post(base + '/web/checkout', json={'plan_slug': 'safe', 'billing_period': 'monthly', 'price_id': 'price_fixture'}).status_code == 409
