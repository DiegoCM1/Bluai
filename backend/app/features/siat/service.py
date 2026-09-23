"""
SIAT-CT service.

Orchestrates: provider fetch → per-user evaluation → DB persistence → per-user push.

Notification strategy (v1.1):
  - device_tokens.user_id is populated at token-registration time; notifications
    are targeted per user (NOT broadcast).
  - A push is sent only when the highest detected level *increases* vs. the
    previous cycle for that user.
  - Minimum level to notify: VERDE (2) — AZUL is informational only.
  - Data source: NHC CurrentStorms.json. There is no official Mexican
    SIAT-CT API; the level/color mapping is derived locally from proximity +
    ETA using the official SIAT-CT 5-step scale (Azul → Rojo).
"""

import json
import logging
from datetime import datetime, timezone

from firebase_admin import messaging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.features.siat.classification import classify_wind_kmh, classification_label
from app.features.siat.direction import parse_movement_direction
from app.features.siat.evaluator import evaluate_user, haversine_km
from app.features.siat.levels import siat_title
from app.features.siat.providers.nhc import fetch_active_cyclones
from app.features.notifications.service import (
    get_tokens_for_users,
    build_apns_config,
    summarize_push_failures,
    _send_multicast_with_retry,
)
from app.features.notification_preferences.service import get_preferences, is_within_quiet_hours

logger = logging.getLogger(__name__)

_NOTIFY_MIN_LEVEL = 2          # VERDE and above trigger push
_QUIET_HOURS_OVERRIDE_LEVEL = 4  # NARANJA and ROJO always fire even in quiet hours


# ---------------------------------------------------------------------------
# Table setup
# ---------------------------------------------------------------------------

async def ensure_siat_tables(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cyclone_events (
                id                  SERIAL PRIMARY KEY,
                source              VARCHAR(50)  NOT NULL,
                name                VARCHAR(100) NOT NULL,
                status              VARCHAR(100),
                lat                 DOUBLE PRECISION NOT NULL,
                lon                 DOUBLE PRECISION NOT NULL,
                wind_kmh            DOUBLE PRECISION,
                pressure            INT,
                movement_direction  VARCHAR(20),
                movement_speed_kmh  DOUBLE PRECISION,
                advisory_time       TIMESTAMPTZ,
                raw_payload         JSONB,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (source, name)
            )
        """))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS siat_assessments (
                id               SERIAL PRIMARY KEY,
                user_id          BIGINT  NOT NULL,
                cyclone_event_id INT     NOT NULL,
                siat_level       INT     NOT NULL,
                siat_color       VARCHAR(20) NOT NULL,
                reason           TEXT,
                distance_km      DOUBLE PRECISION,
                eta_hours        DOUBLE PRECISION,
                source_mode      VARCHAR(20) NOT NULL DEFAULT 'derived',
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, cyclone_event_id)
            )
        """))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_alert_states (
                user_id              BIGINT PRIMARY KEY,
                current_level        INT         NOT NULL DEFAULT 1,
                siat_color           VARCHAR(20) NOT NULL DEFAULT 'AZUL',
                last_notified_level  INT,
                last_notified_at     TIMESTAMPTZ,
                active_cyclone_id    INT,
                updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ"
        ))
    logger.info("SIAT tables verified/created")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _coerce_datetime(val) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)


async def _save_cyclone(db: AsyncSession, cyclone: dict) -> int:
    """Upsert cyclone: if same source+name already exists, update position/intensity."""
    result = await db.execute(
        text("""
            INSERT INTO cyclone_events
                (source, name, status, lat, lon, wind_kmh, pressure,
                 movement_direction, movement_speed_kmh, advisory_time, raw_payload)
            VALUES
                (:source, :name, :status, :lat, :lon, :wind_kmh, :pressure,
                 :movement_direction, :movement_speed_kmh, :advisory_time, CAST(:raw_payload AS jsonb))
            ON CONFLICT (source, name) DO UPDATE SET
                status             = EXCLUDED.status,
                lat                = EXCLUDED.lat,
                lon                = EXCLUDED.lon,
                wind_kmh           = EXCLUDED.wind_kmh,
                pressure           = EXCLUDED.pressure,
                movement_direction = EXCLUDED.movement_direction,
                movement_speed_kmh = EXCLUDED.movement_speed_kmh,
                advisory_time      = EXCLUDED.advisory_time,
                raw_payload        = EXCLUDED.raw_payload
            RETURNING id
        """),
        {
            "source": cyclone["source"],
            "name": cyclone["name"],
            "status": cyclone["status"],
            "lat": cyclone["lat"],
            "lon": cyclone["lon"],
            "wind_kmh": cyclone.get("wind_kmh"),
            "pressure": cyclone.get("pressure"),
            "movement_direction": cyclone.get("movement_direction"),
            "movement_speed_kmh": cyclone.get("movement_speed_kmh"),
            "advisory_time": _coerce_datetime(cyclone.get("advisory_time")),
            "raw_payload": json.dumps(cyclone.get("raw_payload", {})),
        },
    )
    return result.mappings().first()["id"]


async def _get_users_with_location(db: AsyncSession) -> list:
    result = await db.execute(
        text("SELECT id, lat, lon FROM users WHERE lat IS NOT NULL AND lon IS NOT NULL")
    )
    return result.mappings().all()


async def get_affected_users(
    db: AsyncSession, lat: float, lon: float, radius_km: float = 500.0
) -> list[dict]:
    """Return users within radius_km of (lat, lon), sorted by distance ascending."""
    users = await _get_users_with_location(db)
    within = []
    for user in users:
        dist = haversine_km(lat, lon, user["lat"], user["lon"])
        if dist <= radius_km:
            within.append({"user_id": user["id"], "distance_km": round(dist, 2)})
    within.sort(key=lambda x: x["distance_km"])
    return within


async def _get_user_state(db: AsyncSession, user_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT current_level FROM user_alert_states WHERE user_id = :uid"),
        {"uid": user_id},
    )
    return result.mappings().first()


async def _upsert_user_state(
    db: AsyncSession, user_id: int, level: int, color: str, cyclone_id: int
) -> None:
    await db.execute(
        text("""
            INSERT INTO user_alert_states (user_id, current_level, siat_color, active_cyclone_id)
            VALUES (:uid, :level, :color, :cid)
            ON CONFLICT (user_id) DO UPDATE SET
                current_level     = :level,
                siat_color        = :color,
                active_cyclone_id = :cid,
                updated_at        = NOW()
        """),
        {"uid": user_id, "level": level, "color": color, "cid": cyclone_id},
    )


async def _save_assessment(
    db: AsyncSession, user_id: int, cyclone_id: int, result: dict
) -> None:
    """Upsert assessment: one row per user+cyclone, updated on each re-run."""
    await db.execute(
        text("""
            INSERT INTO siat_assessments
                (user_id, cyclone_event_id, siat_level, siat_color,
                 reason, distance_km, eta_hours, source_mode)
            VALUES
                (:uid, :cid, :level, :color, :reason, :dist, :eta, 'derived')
            ON CONFLICT (user_id, cyclone_event_id) DO UPDATE SET
                siat_level  = EXCLUDED.siat_level,
                siat_color  = EXCLUDED.siat_color,
                reason      = EXCLUDED.reason,
                distance_km = EXCLUDED.distance_km,
                eta_hours   = EXCLUDED.eta_hours,
                created_at  = NOW()
        """),
        {
            "uid": user_id,
            "cid": cyclone_id,
            "level": result["siat_level"],
            "color": result["siat_color"],
            "reason": result["reason"],
            "dist": result["distance_km"],
            "eta": result["eta_hours"],
        },
    )


async def _mark_notified(db: AsyncSession, user_id: int, level: int) -> None:
    await db.execute(
        text("""
            UPDATE user_alert_states
            SET last_notified_level = :level, last_notified_at = NOW()
            WHERE user_id = :uid
        """),
        {"level": level, "uid": user_id},
    )


async def _upsert_cyclone_alert(
    db: AsyncSession, cyclone: dict, assessment: dict
) -> str:
    """
    Create an alerts record for a SIAT cyclone escalation. Returns the alert UUID.

    notified_at is set to NOW() here (not left NULL) because this escalation
    already gets its own targeted push via _push_per_user, right after this
    call, in run_cycle. Leaving it NULL made _get_pending_smn_alerts() pick up
    this same brand-new row later in the SAME cycle and fire a SECOND push for
    it through the generic SMN/geofenced path (_notify_smn_alerts) — a real
    duplicate notification for one escalation, observed live. That path is for
    national bulletins / admin-created alerts, not SIAT cyclone escalations.
    """
    level = assessment["siat_level"]
    title = f"Ciclón {cyclone['name']} — {siat_title(level)}"
    short = (assessment.get("reason") or f"Ciclón a {assessment.get('distance_km', '?'):.0f} km")[:500]
    result = await db.execute(
        text("""
            INSERT INTO alerts (level, score, title, short, lat, lon, factors, recommendations, notified_at)
            VALUES (:level, 0, :title, :short, :lat, :lon, '[]', '[]', NOW())
            RETURNING id
        """),
        {
            "level": level, "title": title, "short": short,
            "lat": cyclone["lat"], "lon": cyclone["lon"],
        },
    )
    alert_id = str(result.mappings().first()["id"])
    logger.info("Cyclone alert created: id=%s level=%d title='%s'", alert_id, level, title)
    return alert_id


# ---------------------------------------------------------------------------
# Push notification — per-user (not broadcast)
# ---------------------------------------------------------------------------

async def _push_per_user(
    escalations: dict[int, dict],
    token_map: dict[int, list[str]],
) -> int:
    """
    Send targeted push to each escalated user using only their own tokens.
    Users without registered tokens are silently skipped.
    """
    total_sent = 0

    for user_id, assessment in escalations.items():
        tokens = token_map.get(user_id)
        if not tokens:
            logger.debug("user_id=%d has no registered tokens, skipping push", user_id)
            continue

        level = assessment["siat_level"]
        title = f"Alerta {siat_title(level)}"
        body = assessment["reason"]
        alert_id = assessment.get("alert_id")

        data: dict[str, str] = {
            "siat_level": str(level),
            "siat_color": assessment["siat_color"],
            "alertTitle": title,
            "alertMessage": body,
        }
        if alert_id:
            data["alertId"] = alert_id
        if level >= 4:
            data["fullScreen"] = "true"

        msg = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            data=data,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id="sos_emergency",
                    default_vibrate_timings=False,
                    vibrate_timings_millis=[0, 250, 250, 250],
                ),
            ),
            apns=build_apns_config(interruption_level="time-sensitive"),
            tokens=tokens,
        )

        try:
            # Vía el helper compartido, no `send_each_for_multicast` directo: es lo único
            # que acota el envío a 500 por llamada. Este send es por usuario, así que hoy
            # no se acerca al límite — pero nada en la firma lo impide, y llamar al SDK
            # directo es justo como este sitio quedó sin cota mientras el helper "ya lo
            # resolvía". De paso hereda los reintentos con backoff.
            response = await _send_multicast_with_retry(msg)
            logger.info(
                "Push → user_id=%d level=%s color=%s success=%d failure=%d",
                user_id, assessment["siat_level"], assessment["siat_color"],
                response.success_count, response.failure_count,
            )
            if response.failure_count:
                logger.warning(
                    "Push failures for user_id=%d: %s",
                    user_id, summarize_push_failures(response),
                )
            total_sent += response.success_count
        except Exception as exc:
            logger.error("Firebase push failed for user_id=%d: %s", user_id, exc, exc_info=True)

    return total_sent


# ---------------------------------------------------------------------------
# SMN/CONAGUA alerts → geocercado push
# ---------------------------------------------------------------------------

_SMN_RADIUS_KM = 500.0


async def _get_pending_smn_alerts(db: AsyncSession) -> list:
    # Includes national alerts (lat/lon NULL) — these are handled without radius filtering
    result = await db.execute(text("""
        SELECT id, title, short, ai_summary, level, lat, lon
        FROM alerts
        WHERE notified_at IS NULL
          AND timestamp > NOW() - INTERVAL '35 minutes'
        ORDER BY timestamp DESC
    """))
    return result.mappings().all()


async def _mark_alert_notified(db: AsyncSession, alert_id) -> None:
    await db.execute(
        text("UPDATE alerts SET notified_at = NOW() WHERE id = :id"),
        {"id": alert_id},
    )


async def _push_smn_for_alert(
    db: AsyncSession, alert: dict, users: list
) -> int:
    is_national = alert["lat"] is None or alert["lon"] is None
    affected_user_ids = []
    for user in users:
        if not is_national:
            dist = haversine_km(alert["lat"], alert["lon"], user["lat"], user["lon"])
            if dist > _SMN_RADIUS_KM:
                continue
        prefs = await get_preferences(db, user["id"])
        if prefs["siat_enabled"] and alert["level"] >= prefs["min_siat_level"]:
            if is_within_quiet_hours(prefs) and alert["level"] < _QUIET_HOURS_OVERRIDE_LEVEL:
                continue
            affected_user_ids.append(user["id"])

    if not affected_user_ids:
        return 0

    token_map = await get_tokens_for_users(db, affected_user_ids)
    all_tokens = [t for tokens in token_map.values() for t in tokens]
    if not all_tokens:
        return 0

    smn_title = f"Nueva alerta — {alert['title']}"
    # ai_summary is the plain-language rewrite (SMN general bulletins only, see
    # ai.service.generate_plain_summary) — falls back to the raw scraped `short`
    # when it wasn't generated (LLM unconfigured/unavailable, or a cyclone
    # advisory / admin alert, which don't get one).
    smn_body = alert.get("ai_summary") or alert["short"] or ""
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title=smn_title, body=smn_body),
        data={
            "alert_id": str(alert["id"]),
            "alertId": str(alert["id"]),
            "level": str(alert["level"]),
            "siat_level": str(alert["level"]),
            "alertTitle": smn_title,
            "alertMessage": smn_body,
        },
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                channel_id="sos_emergency",
                default_vibrate_timings=False,
                vibrate_timings_millis=[0, 250, 250, 250],
            ),
        ),
        apns=build_apns_config(interruption_level="time-sensitive"),
        tokens=all_tokens,
    )

    total_sent = 0
    try:
        # **Este es el send que de verdad necesitaba la cota.** `all_tokens` son los
        # tokens de TODOS los usuarios afectados por una alerta del SMN, aplanados: crece
        # con la base de usuarios y no tiene nada que lo limite. Arriba de 500 tokens el
        # SDK tiraba un ValueError del lado del cliente que se comía el `except` de abajo
        # — sin push, sin error de Firebase, y reintentando igual cada 30 minutos.
        response = await _send_multicast_with_retry(msg)
        total_sent = response.success_count
        logger.info(
            "SMN push alert_id=%s level=%d users=%d success=%d failure=%d",
            alert["id"], alert["level"], len(affected_user_ids),
            response.success_count, response.failure_count,
        )
        if response.failure_count:
            logger.warning(
                "SMN push failures alert_id=%s: %s",
                alert["id"], summarize_push_failures(response),
            )
    except Exception as exc:
        logger.error("SMN push failed for alert_id=%s: %s", alert["id"], exc, exc_info=True)

    if total_sent > 0:
        await _mark_alert_notified(db, alert["id"])

    return total_sent


async def _notify_smn_alerts(db: AsyncSession, users: list) -> int:
    if not users:
        return 0

    alerts = await _get_pending_smn_alerts(db)
    if not alerts:
        logger.debug("SMN: no pending alerts")
        return 0

    total_sent = 0
    for alert in alerts:
        total_sent += await _push_smn_for_alert(db, alert, users)

    return total_sent


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def reset_user_siat_state(db: AsyncSession, user_id: int) -> None:
    """Delete all SIAT state for a user so the next injection evaluates from scratch."""
    await db.execute(
        text("DELETE FROM user_alert_states WHERE user_id = :uid"),
        {"uid": user_id},
    )
    await db.commit()


async def inject_smn_test_alert(
    db: AsyncSession, level: int, title: str, short: str
) -> dict:
    """Insert a national test alert and immediately process it via the SMN notify path."""
    result = await db.execute(
        text("""
            INSERT INTO alerts (level, score, title, short, lat, lon, factors, recommendations)
            VALUES (:level, 0, :title, :short, NULL, NULL, '[]', '[]')
            RETURNING id
        """),
        {"level": level, "title": title, "short": short},
    )
    alert_id = str(result.mappings().first()["id"])
    await db.commit()

    users = await _get_users_with_location(db)
    notifications_sent = await _notify_smn_alerts(db, users)
    return {"alert_id": alert_id, "users_evaluated": len(users), "notifications_sent": notifications_sent}


async def inject_and_run_cycle(db: AsyncSession, req) -> dict:
    """Insert a fake cyclone into cyclone_events and immediately run a full SIAT cycle."""
    fake_cyclone: dict = {
        "source": "FAKE",
        "name": req.name,
        "status": classify_wind_kmh(req.wind_kmh),
        "lat": req.lat,
        "lon": req.lon,
        "wind_kmh": req.wind_kmh,
        "pressure": None,
        "movement_direction": req.movement_direction,
        "movement_speed_kmh": req.movement_speed_kmh,
        "advisory_time": datetime.now(timezone.utc),
        "raw_payload": {},
    }
    cyclone_event_id = await _save_cyclone(db, fake_cyclone)
    result = await run_cycle(db, extra_cyclones=[fake_cyclone])
    return {**result, "cyclone_event_id": cyclone_event_id, "cyclone_name": req.name}


async def run_cycle(db: AsyncSession, extra_cyclones: list[dict] | None = None) -> dict:
    logger.info("SIAT run-cycle started")

    users = await _get_users_with_location(db)
    cyclones = await fetch_active_cyclones()
    if extra_cyclones:
        cyclones = cyclones + extra_cyclones

    logger.info("SIAT run-cycle: %d cyclone(s), %d user(s) with location", len(cyclones), len(users))

    all_assessments: list[dict] = []
    escalations: dict[int, dict] = {}  # user_id → highest assessment this cycle (for the push decision)
    best_assessment: dict[int, dict] = {}  # user_id → highest-LEVEL assessment this cycle (for persisted state)
    cyclone_map: dict[int, dict] = {}  # cyclone_id → cyclone data (for alert creation)

    for cyclone in (cyclones if users else []):
        try:
            cyclone_id = await _save_cyclone(db, cyclone)
            cyclone_map[cyclone_id] = cyclone
            logger.info("Cyclone saved: id=%d name=%s status=%s", cyclone_id, cyclone["name"], cyclone["status"])
        except Exception as exc:
            logger.error("Failed to save cyclone %s: %s", cyclone.get("name"), exc, exc_info=True)
            continue

        for user in users:
            try:
                assessment = evaluate_user(user["lat"], user["lon"], cyclone)

                if assessment.get("out_of_range"):
                    logger.debug(
                        "user_id=%d: cyclone %s out of range (%.0f km), skipping assessment",
                        user["id"], cyclone["name"], assessment["distance_km"],
                    )
                    continue

                # Reads the state from BEFORE this cycle started — user_alert_states
                # is only written once per user, after every cyclone has been
                # evaluated (see below), so this stays stable across the whole loop.
                old_state = await _get_user_state(db, user["id"])
                old_level = old_state["current_level"] if old_state else None
                new_level = assessment["siat_level"]

                logger.debug(
                    "user_id=%d cyclone=%s dist=%.1fkm eta=%s level=%s→%s",
                    user["id"], cyclone["name"],
                    assessment["distance_km"],
                    f"{assessment['eta_hours']:.1f}h" if assessment["eta_hours"] else "N/A",
                    old_level, new_level,
                )

                await _save_assessment(db, user["id"], cyclone_id, assessment)

                # Track the worst active threat per user across ALL cyclones this
                # cycle. Persisting per-cyclone here (instead of after the loop)
                # would make current_level reflect whichever cyclone happened to
                # be evaluated last, not the most dangerous one.
                prev_best = best_assessment.get(user["id"])
                if prev_best is None or new_level > prev_best["siat_level"]:
                    best_assessment[user["id"]] = {**assessment, "cyclone_id": cyclone_id}

                if new_level >= _NOTIFY_MIN_LEVEL and (old_level is None or new_level > old_level):
                    prefs = await get_preferences(db, user["id"])
                    if prefs["siat_enabled"] and new_level >= prefs["min_siat_level"]:
                        if is_within_quiet_hours(prefs) and new_level < _QUIET_HOURS_OVERRIDE_LEVEL:
                            logger.debug(
                                "user_id=%d: push suppressed by quiet hours (level=%d)",
                                user["id"], new_level,
                            )
                        else:
                            prev = escalations.get(user["id"])
                            if prev is None or new_level > prev["siat_level"]:
                                escalations[user["id"]] = {**assessment, "cyclone_id": cyclone_id}
                                logger.info(
                                    "Escalation queued: user_id=%d %s→%s (%s)",
                                    user["id"], old_level, new_level, assessment["siat_color"],
                                )
                    else:
                        logger.debug(
                            "user_id=%d: push filtered by prefs (siat_enabled=%s, min_siat_level=%d, got=%d)",
                            user["id"], prefs["siat_enabled"], prefs["min_siat_level"], new_level,
                        )

                all_assessments.append({**assessment, "user_id": user["id"]})

            except Exception as exc:
                logger.error(
                    "Failed to evaluate user_id=%d for cyclone %s: %s",
                    user["id"], cyclone.get("name"), exc, exc_info=True,
                )
                continue

    # Persist current_level ONCE per user, using the worst threat found this
    # cycle across every active cyclone — not per-cyclone inside the loop above.
    for user_id, assessment in best_assessment.items():
        await _upsert_user_state(
            db, user_id, assessment["siat_level"], assessment["siat_color"], assessment["cyclone_id"]
        )

    notifications_sent = 0
    if escalations:
        # Create one alerts record per unique cyclone that triggered escalations
        cyclone_alert_ids: dict[int, str] = {}
        for assessment in escalations.values():
            cid = assessment["cyclone_id"]
            if cid not in cyclone_alert_ids:
                cyclone = cyclone_map[cid]
                cyclone_alert_ids[cid] = await _upsert_cyclone_alert(db, cyclone, assessment)
        for assessment in escalations.values():
            assessment["alert_id"] = cyclone_alert_ids.get(assessment["cyclone_id"])

        token_map = await get_tokens_for_users(db, list(escalations.keys()))
        notifications_sent = await _push_per_user(escalations, token_map)
        for user_id, assessment in escalations.items():
            await _mark_notified(db, user_id, assessment["siat_level"])
    else:
        logger.info("SIAT run-cycle: no escalations, no push sent")

    notifications_sent += await _notify_smn_alerts(db, users)

    await db.commit()

    logger.info(
        "SIAT run-cycle complete: cyclones=%d users=%d notifications=%d",
        len(cyclones), len(users), notifications_sent,
    )

    return {
        "cyclones_found": len(cyclones),
        "users_evaluated": len(users),
        "notifications_sent": notifications_sent,
        "assessments": all_assessments,
    }


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

async def get_user_siat_status(db: AsyncSession, user_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT * FROM user_alert_states WHERE user_id = :uid"),
        {"uid": user_id},
    )
    return result.mappings().first()


async def get_active_cyclones(db: AsyncSession, max_age_hours: int = 72) -> list[dict]:
    """
    Cyclones (real + fake) recent enough to still be worth showing on the map.
    Enriches each row with its intensity classification and a parsed heading
    in degrees, for the map's category label and direction arrow.

    Excludes (0, 0): a storm that's no longer in NHC's live feed (dissipated,
    or the feed dropped it) stops getting fresh saves, so a row from before a
    transient feed glitch — or from before the nhc.py provider fix — can sit
    at (0, 0) for the entire max_age_hours window with no further write to
    correct it. (0, 0) is never a plausible position for a storm this feed
    tracks, so it's filtered here rather than trusted blindly.
    """
    result = await db.execute(
        text("""
            SELECT id, source, name, lat, lon, wind_kmh,
                   movement_direction, movement_speed_kmh, advisory_time
            FROM cyclone_events
            WHERE advisory_time > NOW() - make_interval(hours => :max_age_hours)
              AND NOT (lat = 0 AND lon = 0)
            ORDER BY advisory_time DESC
        """),
        {"max_age_hours": max_age_hours},
    )
    rows = result.mappings().all()

    cyclones = []
    for row in rows:
        wind_kmh = row["wind_kmh"] or 0.0
        category_code = classify_wind_kmh(wind_kmh)
        cyclones.append({
            **row,
            "category_code": category_code,
            "category_label": classification_label(category_code),
            "movement_direction_deg": parse_movement_direction(row["movement_direction"]),
        })
    return cyclones


async def assess_location(db: AsyncSession, lat: float, lon: float) -> list[dict]:
    """
    Every active cyclone evaluated against one location, worst threat first
    (ties broken by distance).

    Public, read-only contract for callers outside SIAT (the AI chat tool):
    no DB writes, no commit, no notifications — run_cycle stays the only
    path that persists assessments or pushes. Uses the same evaluate_user()
    as run_cycle, so any change to SIAT's scoring shows up here for free.

    Guaranteed keys per item: name, category_label, advisory_time,
    siat_level, distance_km, eta_hours, out_of_range.

    Evaluation errors propagate on purpose: silently dropping a storm could
    turn "couldn't check" into "no threat", so the caller must handle failure.
    """
    assessments = []
    for cyclone in await get_active_cyclones(db):
        # The column is nullable; evaluate_user compares wind_kmh numerically.
        # Same guard get_active_cyclones applies for its own classification.
        evaluable = {**cyclone, "wind_kmh": cyclone["wind_kmh"] or 0.0}
        assessment = evaluate_user(lat, lon, evaluable)
        assessments.append({
            "name": cyclone["name"],
            "category_label": cyclone["category_label"],
            "advisory_time": cyclone["advisory_time"],
            **assessment,
        })
    # Worst level first; among equal levels, nearest first.
    assessments.sort(key=lambda a: (-a["siat_level"], a["distance_km"]))
    return assessments
