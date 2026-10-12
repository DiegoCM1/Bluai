from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.billing import router as billing
from app.features.billing.schemas import FiscalProfile


PROFILE = dict(rfc="AAA010101AAA", legal_name="EMPRESA EJEMPLO",
               postal_code="06000", tax_regime="601", cfdi_use="G03")


@pytest.mark.parametrize("field,value", [
    ("rfc", "INVALIDORFC12"), ("postal_code", "6000"),
    ("tax_regime", "xx1"), ("cfdi_use", "XYZ"), ("legal_name", "  "),
])
def test_rejects_invalid_fiscal_data(field, value):
    with pytest.raises(ValidationError):
        FiscalProfile(**{**PROFILE, field: value})


def test_normalizes_and_preserves_postal_zero():
    profile = FiscalProfile(**{**PROFILE, "rfc": " aaa010101aaa ",
                               "legal_name": " Empresa Ejemplo "})
    assert profile.model_dump() == PROFILE


@pytest.mark.asyncio
async def test_profile_uses_authenticated_owner_and_issuance_is_disabled(monkeypatch):
    app = FastAPI()
    app.include_router(billing.router)
    db = object()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"uid": "buyer-uid"}
    lookup = AsyncMock(return_value={"id": 42})
    save = AsyncMock(return_value=PROFILE)
    monkeypatch.setattr(billing, "get_user_by_firebase_uid", lookup)
    monkeypatch.setattr(billing, "save_fiscal_profile", save)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test") as client:
        response = await client.put("/api/v1/billing/profile", json=PROFILE)
        assert response.status_code == 200
        lookup.assert_awaited_once_with(db, "buyer-uid")
        assert save.await_args.args[1] == 42
        response = await client.put("/api/v1/billing/profile",
                                    json={**PROFILE, "user_id": 99})
        assert response.status_code == 422
        assert save.await_count == 1
        response = await client.get("/api/v1/billing/capabilities")
        assert response.json()["invoice_issuance_available"] is False
