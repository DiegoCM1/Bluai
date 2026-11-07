from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.features.users.service import get_user_by_firebase_uid, public_display_name
from app.features.sos_trigger.schemas import SOSTriggerRequest, SOSTriggerResponse
from app.features.sos_trigger.service import trigger_sos

router = APIRouter()


@router.post("/api/v1/sos/trigger", response_model=SOSTriggerResponse)
async def sos_trigger_route(
    body: SOSTriggerRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    db_user = await get_user_by_firebase_uid(db, user.get("uid"))
    if db_user is None:
        raise HTTPException(
            status_code=404,
            detail="User profile not found. Call POST /api/v1/users/me first.",
        )
    return await trigger_sos(
        db,
        sender_id=int(db_user["id"]),
        sender_display_name=public_display_name(db_user, user.get("name")),
        lat=body.lat,
        lon=body.lon,
    )
