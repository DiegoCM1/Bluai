from fastapi import APIRouter, Depends, HTTPException, Response
from typing import Literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid
from .schemas import BillingCapabilities, FiscalProfile, InvoiceRequest, TestInvoice
from .service import get_fiscal_profile, save_fiscal_profile

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


@router.get("/capabilities", response_model=BillingCapabilities)
async def capabilities():
    return BillingCapabilities()


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


