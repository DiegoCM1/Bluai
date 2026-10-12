from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.features.billing import invoices, provider, router


@pytest.mark.asyncio
async def test_production_exposes_demo_without_live_invoice_claim(monkeypatch):
    monkeypatch.setattr(settings, "RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setattr(provider, "configured", lambda: True)
    capabilities = await router.capabilities()
    assert capabilities.status == "facturapi_demo"
    assert capabilities.demo_invoicing_available is True
    assert capabilities.invoice_issuance_available is False


@pytest.mark.asyncio
async def test_demo_does_not_query_or_claim_a_stripe_payment(monkeypatch):
    monkeypatch.setattr(provider, "test_key", lambda: "sk_test_example")
    profile = dict(rfc="AAA010101AAA", legal_name="EMPRESA EJEMPLO", postal_code="06000", tax_regime="601", cfdi_use="G03")
    monkeypatch.setattr(invoices, "get_fiscal_profile", AsyncMock(return_value=profile))
    persist = AsyncMock(return_value={"id": "a" * 24, "payment_id": "demo", "status": "valid", "mode": "test"})
    monkeypatch.setattr(invoices, "persist_invoice", persist)
    stripe = AsyncMock()
    monkeypatch.setattr(invoices, "stripe_call", stripe)
    result = await invoices.demo_issue(None, 42)
    stripe.assert_not_awaited()
    assert result["payment_id"] is None
    first = persist.await_args.args
    await invoices.demo_issue(None, 42)
    assert persist.await_args.args == first
    assert first[2].startswith("demo_42_")
    assert first[3]["items"][0]["product"]["price"] == 4.99
