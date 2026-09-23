import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

logger = logging.getLogger(__name__)
from app.features.alerts.openweather_service import fetch_mexico_overview, fetch_onecall_alerts
from app.features.alerts.schemas import (
    ActiveAlertItem,
    ActiveAlertsResponse,
    AlertCreate,
    AlertDetail,
    AlertSummary,
    MexicoWeatherOverviewResponse,
    OneCallAlertsResponse,
    SiatUserState,
    SMNBulletin,
    SMNCycloneAdvisory,
)
from app.features.alerts.service import (
    create_alert,
    get_alert_by_id,
    get_alerts,
    get_general_alerts_for_active,
    get_smn_cyclone_advisories,
    get_user_siat_state,
)
from app.features.alerts.providers.smn import fetch_latest_bulletin
from app.features.users.service import get_user_by_firebase_uid
from app.core.auth import get_current_user
from app.middleware.api_key_auth import verify_api_key
from app.features.siat.levels import siat_color, siat_title


router = APIRouter()


@router.post("/api/v1/alerts", response_model=AlertDetail, status_code=201,
             dependencies=[Depends(verify_api_key)])
async def create_alert_v1(body: AlertCreate, db: AsyncSession = Depends(get_db)):
    """Create a new alert. Protected by X-API-Key (internal/admin use)."""
    return await create_alert(
        db=db,
        level=body.level, score=body.score, title=body.title, short=body.short,
        lat=body.lat, lon=body.lon, factors=body.factors, recommendations=body.recommendations,
    )


@router.get("/alerts", response_model=list[AlertSummary])
async def list_alerts(db: AsyncSession = Depends(get_db), limit: int = 30, offset: int = 0, user=Depends(get_current_user)):
    return await get_alerts(db, limit, offset)


@router.get("/api/v1/alerts", response_model=list[AlertSummary])
async def list_alerts_v1(db: AsyncSession = Depends(get_db), limit: int = 30, offset: int = 0, user=Depends(get_current_user)):
    return await get_alerts(db, limit, offset)


@router.get("/api/v1/alerts/active", response_model=ActiveAlertsResponse)
async def get_active_alerts(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Unified alert feed for the authenticated user.
    Priority: SIAT cyclonic risk (primary) → system alerts → SMN bulletin (informational).
    """
    firebase_uid = user.get("uid")
    db_user = await get_user_by_firebase_uid(db, firebase_uid)

    # --- SIAT state (cyclonic risk for this user) ---
    user_siat: SiatUserState | None = None
    cyclonic_alerts: list[ActiveAlertItem] = []

    if db_user is not None:
        siat_state = await get_user_siat_state(db, db_user["id"])
        if siat_state and siat_state["current_level"] >= 1:
            level = siat_state["current_level"]
            color = siat_state["siat_color"]
            # Use the real assessment reason (cyclone name, distance, ETA)
            # if available; fall back to generic title otherwise
            assessment_reason = siat_state.get("reason") or siat_title(level)
            user_siat = SiatUserState(
                level=level,
                color=color,
                reason=assessment_reason,
                updated_at=siat_state["updated_at"],
            )
            if level >= 2:  # VERDE and above → show as actionable alert
                cyclonic_alerts.append(ActiveAlertItem(
                    source="SIAT-CT",
                    type="cyclonic",
                    level=level,
                    color=color,
                    title=siat_title(level),
                    short=assessment_reason,
                ))

    # --- System alerts (admin-created, most recent 5) — excludes SMN cyclone
    # advisories, which get their own dedicated section below ---
    raw_alerts = await get_general_alerts_for_active(db, limit=5)
    general_alerts = [
        ActiveAlertItem(
            source="SYSTEM",
            type="system",
            level=a["level"],
            color=siat_color(a["level"]),
            title=a["title"],
            # ai_summary is the plain-language rewrite (SMN bulletins only) —
            # falls back to the raw `short` for every other alert source.
            short=a["ai_summary"] or a["short"],
        )
        for a in raw_alerts
    ]

    # --- SMN bulletin (complementary, best-effort) ---
    smn_bulletin: SMNBulletin | None = None
    try:
        raw_bulletin = await fetch_latest_bulletin()
        if raw_bulletin:
            smn_bulletin = SMNBulletin(**raw_bulletin)
    except Exception as exc:
        logger.warning("SMN bulletin unavailable, continuing without it: %s", exc)

    # --- SMN cyclone advisories (Atlántico/Pacífico), structured, from DB ---
    raw_cyclone_advisories = await get_smn_cyclone_advisories(db)
    smn_cyclone_advisories = [SMNCycloneAdvisory(**a) for a in raw_cyclone_advisories]

    return ActiveAlertsResponse(
        generated_at=datetime.now(timezone.utc),
        user_siat=user_siat,
        cyclonic_alerts=cyclonic_alerts,
        general_alerts=general_alerts,
        smn_bulletin=smn_bulletin,
        smn_cyclone_advisories=smn_cyclone_advisories,
    )


@router.get("/api/v1/alerts/weather", response_model=OneCallAlertsResponse)
async def list_weather_alerts_v1(
    lat: float,
    lon: float,
    exclude: str | None = "minutely,daily",
    user=Depends(get_current_user)
):
    return await fetch_onecall_alerts(lat=lat, lon=lon, exclude=exclude)


@router.get("/api/v1/alerts/weather/mx", response_model=MexicoWeatherOverviewResponse)
async def list_weather_alerts_mx_v1(
    exclude: str | None = "minutely,daily", user=Depends(get_current_user)
):
    return await fetch_mexico_overview(exclude=exclude)


@router.get("/alerts/{id}", response_model=AlertDetail)
async def list_alert(id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    alert = await get_alert_by_id(db, id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/api/v1/alerts/{id}", response_model=AlertDetail)
async def list_alert_v1(id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    alert = await get_alert_by_id(db, id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert
