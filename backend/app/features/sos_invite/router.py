from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid, public_display_name
from app.features.sos_invite.schemas import InviteAcceptResponse, InviteCreateResponse, InvitePreviewResponse
from app.features.sos_invite.service import accept_invite, create_invite, get_invite_preview, reject_invite

router = APIRouter()


async def _resolve_user_id(db: AsyncSession, user: dict) -> int:
    db_user = await get_user_by_firebase_uid(db, user.get("uid"))
    if db_user is None:
        raise HTTPException(status_code=404, detail="User profile not found. Call POST /api/v1/users/me first.")
    return int(db_user["id"])


@router.post(
    "/api/v1/sos-contacts/{contact_id}/invite",
    response_model=InviteCreateResponse,
    status_code=201,
)
async def invite_contact(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user.get("uid"))
    if db_user is None:
        raise HTTPException(status_code=404, detail="User profile not found. Call POST /api/v1/users/me first.")
    display_name = public_display_name(db_user, user.get("name"))
    return await create_invite(db, int(db_user["id"]), display_name, contact_id)


@router.get(
    "/api/v1/sos-invitations/preview/{token}",
    response_model=InvitePreviewResponse,
)
async def preview_invitation(token: str, db: AsyncSession = Depends(get_db)):
    return await get_invite_preview(db, token)


@router.post(
    "/api/v1/sos-invitations/{token}/accept",
    response_model=InviteAcceptResponse,
)
async def accept_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    caller_id = await _resolve_user_id(db, user)
    return await accept_invite(db, token, caller_id)


@router.post("/api/v1/sos-invitations/{token}/reject", status_code=204)
async def reject_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    caller_id = await _resolve_user_id(db, user)
    await reject_invite(db, token, caller_id)
