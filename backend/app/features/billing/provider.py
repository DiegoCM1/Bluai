"""Facturapi Test only: never emit a valid fiscal document or incur live fees."""
import re

import httpx
from fastapi import HTTPException

from app.core.config import settings
from .schemas import FiscalProfile

BASE_URL = "https://www.facturapi.io/v2"


def test_key() -> str:
    key = settings.FACTURAPI_TEST_SECRET_KEY
    if not key.startswith("sk_test_") or key == "sk_test_...":
        raise HTTPException(503, "Configura la Test Secret Key de Facturapi en el servidor.")
    return key


def configured() -> bool:
    try:
        test_key()
        return True
    except HTTPException:
        return False


def test_payload(profile: FiscalProfile, amount_cents: int, currency: str, reference: str) -> dict:
    currency = currency.upper()
    if amount_cents <= 0 or currency not in {"USD", "MXN"}:
        raise HTTPException(409, "El importe o moneda no permite generar esta factura de prueba.")
    return {
        "type": "I", "customer": {
            "legal_name": profile.legal_name, "tax_id": profile.rfc,
            "tax_system": profile.tax_regime, "address": {"zip": profile.postal_code},
        },
        "use": profile.cfdi_use, "payment_form": "04", "payment_method": "PUE",
        "currency": currency,
        "exchange": settings.FACTURAPI_TEST_USD_EXCHANGE if currency == "USD" else 1,
        "items": [{"quantity": 1, "product": {
            "description": "Membresía Bluai — PRUEBA SIN VALIDEZ FISCAL",
            "product_key": "81112100", "unit_key": "E48",
            "price": amount_cents / 100, "tax_included": True,
            "taxability": "02", "taxes": [{"type": "IVA", "rate": 0.16}],
        }}],
        "external_id": reference, "idempotency_key": reference,
        "pdf_custom_section": "<p>DOCUMENTO DE PRUEBA SIN VALIDEZ FISCAL</p>",
    }


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        try:
            response = await client.request(method, BASE_URL + path,
                headers={"Authorization": "Bearer " + test_key()}, **kwargs)
        except httpx.RequestError:
            raise HTTPException(503, "Facturapi no respondió. Reintenta la misma solicitud; no hagas otro pago.") from None
    if response.status_code == 400:
        raise HTTPException(422, "Facturapi rechazó los datos fiscales. Revisa RFC, nombre, régimen y uso del CFDI.")
    if response.status_code not in {200, 201, 202}:
        raise HTTPException(503, "Facturapi Test no está disponible. Revisa la clave de pruebas y la organización.")
    return response


def validate_invoice(data: dict) -> dict:
    if data.get("livemode") is not False or not re.fullmatch(r"[a-fA-F0-9]{24}", str(data.get("id", ""))):
        raise HTTPException(502, "El proveedor no devolvió una factura de prueba válida.")
    return data


async def create_invoice(payload: dict) -> dict:
    return validate_invoice((await request("POST", "/invoices", json=payload)).json())


async def get_invoice(invoice_id: str) -> dict:
    if not re.fullmatch(r"[a-fA-F0-9]{24}", invoice_id):
        raise HTTPException(404, "Factura no encontrada.")
    return validate_invoice((await request("GET", "/invoices/" + invoice_id)).json())


async def download(invoice_id: str, file_format: str) -> bytes:
    data = await get_invoice(invoice_id)
    if data.get("status") != "valid":
        raise HTTPException(409, "El documento de prueba sigue pendiente o no está disponible.")
    return (await request("GET", f"/invoices/{invoice_id}/{file_format}")).content
