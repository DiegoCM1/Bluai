from unittest.mock import AsyncMock, patch
import pytest
from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient
from app.core.config import settings
from app.features.payments.environment import stripe_setting
from app.features.payments import web, router as payments


@pytest.fixture(autouse=True)
def sandbox(monkeypatch):
    for key, value in {
        'STRIPE_MODE': 'test', 'RAILWAY_ENVIRONMENT_NAME': 'staging',
        'STRIPE_TEST_SECRET_KEY': 'sk_test_fixture', 'STRIPE_SECRET_KEY': 'sk_live_do_not_use',
        'STRIPE_TEST_WEBHOOK_SECRET': 'whsec_test', 'STRIPE_WEBHOOK_SECRET': 'whsec_live',
        'STRIPE_TEST_PRICE_SAFE_MONTHLY': 'price_test', 'STRIPE_PRICE_SAFE_MONTHLY': 'price_live',
        'WEB_PAYMENTS_ENABLED': True, 'WEB_PAYMENTS_ORIGIN': 'https://dev.example.com',
    }.items():
        monkeypatch.setattr(settings, key, value)


def test_test_keys_and_web_origin():
    assert stripe_setting('SECRET_KEY') == 'sk_test_fixture'
    assert stripe_setting('WEBHOOK_SECRET') == 'whsec_test'
    assert stripe_setting('PRICE_SAFE_MONTHLY') == 'price_test'
    assert web.configuration() == 'https://dev.example.com'


@pytest.mark.parametrize('environment,mode', [('production', 'test'), ('staging', 'live'), ('staging', 'invalid')])
def test_rejects_wrong_environment(monkeypatch, environment, mode):
    monkeypatch.setattr(settings, 'RAILWAY_ENVIRONMENT_NAME', environment)
    monkeypatch.setattr(settings, 'STRIPE_MODE', mode)
    with pytest.raises(HTTPException):
        stripe_setting('SECRET_KEY')


def test_missing_test_key_never_falls_back_to_live(monkeypatch):
    monkeypatch.setattr(settings, 'STRIPE_TEST_SECRET_KEY', '')
    with pytest.raises(HTTPException):
        web.configuration()


@pytest.mark.asyncio
async def test_sandbox_price_is_accepted_but_live_price_is_rejected(monkeypatch):
    price = {'livemode': False, 'active': True, 'billing_scheme': 'per_unit', 'unit_amount': 499,
             'currency': 'usd', 'recurring': {'interval': 'month', 'interval_count': 1, 'usage_type': 'licensed'}}
    call = AsyncMock(return_value=price)
    monkeypatch.setattr(web, 'stripe_call', call)
    assert (await web.live_price('safe', 'monthly'))['mode'] == 'test'
    assert call.call_args.args[1] == 'price_test'
    price['livemode'] = True
    with pytest.raises(HTTPException):
        await web.live_price('safe', 'monthly')


def test_webhook_rejects_signed_event_from_wrong_mode():
    from app.core.database import get_db
    app = FastAPI()
    app.include_router(payments.router)
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    with patch('stripe.Webhook.construct_event', return_value={'livemode': True}) as verify:
        result = TestClient(app).post('/api/v1/payments/webhook/stripe', content=b'{}', headers={'stripe-signature': 'fixture'})
    assert result.status_code == 400
    assert verify.call_args.args[2] == 'whsec_test'


def test_live_uses_only_live_keys(monkeypatch):
    monkeypatch.setattr(settings, 'STRIPE_MODE', 'live')
    monkeypatch.setattr(settings, 'RAILWAY_ENVIRONMENT_NAME', 'production')
    assert stripe_setting('SECRET_KEY') == 'sk_live_do_not_use'
    assert stripe_setting('WEBHOOK_SECRET') == 'whsec_live'
