from fastapi import APIRouter, Depends, HTTPException, Response
from typing import Literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid
from .schemas import BillingCapabilities, FiscalProfile, InvoiceRequest, TestInvoice
from . import invoices, provider
from .service import get_fiscal_profile, save_fiscal_profile

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


@router.get("/capabilities", response_model=BillingCapabilities)
async def capabilities():
    ready = provider.configured()
    try:
        invoices.stripe_key()
        stripe_ready = True
    except HTTPException:
        stripe_ready = False
    return BillingCapabilities(invoice_issuance_available=ready and stripe_ready,
                               status="facturapi_test" if ready else "pending_provider_setup")


async def billing_user_id(
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
) -> int:
    db_user = await get_user_by_firebase_uid(db, user["uid"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return int(db_user["id"])


@router.get("/profile", response_model=FiscalProfile | None)
async def read_profile(
    db: AsyncSession = Depends(get_db), user_id: int = Depends(billing_user_id),
):
    return await get_fiscal_profile(db, user_id)


@router.put("/profile", response_model=FiscalProfile)
async def write_profile(
    body: FiscalProfile, db: AsyncSession = Depends(get_db),
    user_id: int = Depends(billing_user_id),
):
    return await save_fiscal_profile(db, user_id, body)


@router.get("/payments")
async def paid_memberships(db: AsyncSession = Depends(get_db), user_id: int = Depends(billing_user_id)):
    return await invoices.list_payments(db, user_id)


@router.post("/invoices", response_model=TestInvoice)
async def create_test_invoice(body: InvoiceRequest, db: AsyncSession = Depends(get_db), user_id: int = Depends(billing_user_id)):
    return await invoices.issue(db, user_id, body.payment_id)


@router.get("/invoices/{invoice_id}/{file_format}")
async def download_test_invoice(invoice_id: str, file_format: Literal["xml", "pdf"],
    db: AsyncSession = Depends(get_db), user_id: int = Depends(billing_user_id)):
    await invoices.owns_invoice(db, user_id, invoice_id)
    content = await provider.download(invoice_id, file_format)
    return Response(content, media_type="application/pdf" if file_format == "pdf" else "application/xml",
        headers={"Content-Disposition": f'attachment; filename="bluai-prueba.{file_format}"', "Cache-Control": "no-store"})
