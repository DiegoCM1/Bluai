from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.features.billing import invoices, provider
from app.features.billing.schemas import FiscalProfile

PROFILE = FiscalProfile(rfc="AAA010101AAA", legal_name="EMPRESA EJEMPLO",
                        postal_code="06000", tax_regime="601", cfdi_use="G03")
DOCUMENT = {"id": "a" * 24, "livemode": False, "status": "valid"}
PAYMENT = {"id": "in_test123", "status": "paid", "livemode": False,
           "amount_paid": 499, "currency": "usd", "subscription": "sub_owned"}


@pytest.mark.parametrize("key", ["", "sk_live_fake", "sk_user_fake", "sk_test_..."])
def test_rejects_missing_and_non_test_keys(monkeypatch, key):
    monkeypatch.setattr(settings, "FACTURAPI_TEST_SECRET_KEY", key)
    assert provider.configured() is False
    with pytest.raises(HTTPException) as exc:
        provider.test_key()
    assert exc.value.status_code == 503


@pytest.mark.parametrize("change,status", [
    ({"livemode": True}, 404), ({"subscription": "sub_someone_else"}, 404),
    ({"status": "open"}, 409), ({"amount_paid": 0}, 409),
])
def test_rejects_live_unpaid_or_foreign_payments(change, status):
    with pytest.raises(HTTPException) as exc:
        invoices.validate_payment({**PAYMENT, **change}, "sub_owned")
    assert exc.value.status_code == status


def test_new_stripe_parent_format_and_payload_amount():
    payment = {**PAYMENT, "subscription": None,
               "parent": {"subscription_details": {"subscription": "sub_owned"}}}
    invoices.validate_payment(payment, "sub_owned")
    payload = provider.test_payload(PROFILE, payment["amount_paid"], "usd", "same-payment")
    assert payload["items"][0]["product"]["price"] == 4.99
    assert payload["customer"]["address"]["zip"] == "06000"
    assert payload["idempotency_key"] == "same-payment"
    assert payload["currency"] == "USD"


@pytest.mark.asyncio
async def test_invoice_response_must_be_test(monkeypatch):
    call = AsyncMock(return_value=httpx.Response(200, json={**DOCUMENT, "livemode": True}))
    monkeypatch.setattr(provider, "request", call)
    with pytest.raises(HTTPException) as exc:
        await provider.create_invoice({})
    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_timeout_returns_actionable_error_without_secret(monkeypatch):
    monkeypatch.setattr(settings, "FACTURAPI_TEST_SECRET_KEY", "sk_test_private")
    call = AsyncMock(side_effect=httpx.ReadTimeout("sk_test_private"))
    monkeypatch.setattr(httpx.AsyncClient, "request", call)
    with pytest.raises(HTTPException) as exc:
        await provider.create_invoice({})
    assert exc.value.status_code == 503
    assert "sk_test_private" not in exc.value.detail


@pytest.mark.asyncio
async def test_download_requires_valid_document(monkeypatch):
    monkeypatch.setattr(provider, "get_invoice", AsyncMock(return_value={**DOCUMENT, "status": "pending"}))
    call = AsyncMock()
    monkeypatch.setattr(provider, "request", call)
    with pytest.raises(HTTPException) as exc:
        await provider.download(DOCUMENT["id"], "pdf")
    assert exc.value.status_code == 409
    call.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_reuses_saved_fiscal_snapshot(monkeypatch):
    monkeypatch.setattr(settings, "FACTURAPI_TEST_SECRET_KEY", "sk_test_private")
    monkeypatch.setattr(invoices, "subscription_id", AsyncMock(return_value="sub_owned"))
    monkeypatch.setattr(invoices, "stripe_call", AsyncMock(return_value=PAYMENT))
    monkeypatch.setattr(invoices, "get_fiscal_profile", AsyncMock(return_value=PROFILE.model_dump()))
    original = provider.test_payload(PROFILE, 499, "usd", "bluai-test-in_test123")
    original["customer"]["legal_name"] = "ORIGINAL FISCAL SNAPSHOT"
    result = MagicMock()
    result.mappings.return_value.first.return_value = {"provider_id": None, "payload": original}
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    create = AsyncMock(return_value=DOCUMENT)
    monkeypatch.setattr(provider, "create_invoice", create)
    response = await invoices.issue(db, 42, "in_test123")
    create.assert_awaited_once_with(original)
    assert response["id"] == DOCUMENT["id"]
    assert response["payment_id"] == "in_test123"


@pytest.mark.asyncio
async def test_download_ownership_is_required():
    db = MagicMock()
    result = MagicMock()
    result.first.return_value = None
    db.execute = AsyncMock(return_value=result)
    with pytest.raises(HTTPException) as exc:
        await invoices.owns_invoice(db, 99, DOCUMENT["id"])
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_xml_and_pdf_use_authenticated_provider_endpoint(monkeypatch):
    monkeypatch.setattr(provider, "get_invoice", AsyncMock(return_value=DOCUMENT))
    call = AsyncMock(return_value=httpx.Response(200, content=b"test-document"))
    monkeypatch.setattr(provider, "request", call)
    for file_format in ("xml", "pdf"):
        assert await provider.download(DOCUMENT["id"], file_format) == b"test-document"
        call.assert_awaited_with("GET", f'/invoices/{DOCUMENT["id"]}/{file_format}')
