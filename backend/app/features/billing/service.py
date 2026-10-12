from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import FiscalProfile


async def get_fiscal_profile(db: AsyncSession, user_id: int) -> dict | None:
    result = await db.execute(text("""
        SELECT rfc, legal_name, postal_code, tax_regime, cfdi_use
        FROM fiscal_profiles WHERE user_id = :user_id
    """), {"user_id": user_id})
    row = result.mappings().first()
    return dict(row) if row else None


async def save_fiscal_profile(
    db: AsyncSession, user_id: int, profile: FiscalProfile,
) -> dict:
    values = profile.model_dump()
    await db.execute(text("""
        INSERT INTO fiscal_profiles
            (user_id, rfc, legal_name, postal_code, tax_regime, cfdi_use)
        VALUES (:user_id, :rfc, :legal_name, :postal_code, :tax_regime, :cfdi_use)
        ON CONFLICT (user_id) DO UPDATE SET
            rfc = EXCLUDED.rfc, legal_name = EXCLUDED.legal_name,
            postal_code = EXCLUDED.postal_code, tax_regime = EXCLUDED.tax_regime,
            cfdi_use = EXCLUDED.cfdi_use, updated_at = NOW()
    """), {"user_id": user_id, **values})
    await db.commit()
    return values
