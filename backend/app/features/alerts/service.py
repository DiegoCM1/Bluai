import json
import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def _smn_headline_to_level(headline: str) -> int:
    """
    Derive a SIAT level (1-5) from SMN headline/synthesis keywords.

    Deliberate decision, not an accident: this is a keyword heuristic over
    Saffir-Simpson wording ("CATEGORÍA 4/5") and generic severity adjectives
    ("SEVER", "GRAVE"), NOT the proximity+ETA math `siat/evaluator.py` uses for
    cyclone escalations. It exists because SMN bulletins/advisories are free
    text with no lat/lon/speed for this user to evaluate against — there is no
    real SIAT level to compute, only a best-effort proxy so the bulletin can
    still be shown with a color/severity that's roughly in the right ballpark.
    Treat the result as informational, not as an official SIAT-CT level.
    """
    hl = headline.upper()
    if any(k in hl for k in ("ROJO", "EXTREM", "EXCEPCIONAL", "CATEGORÍA 4", "CATEGORÍA 5")):
        return 5
    if any(k in hl for k in ("NARANJA", "SEVER", "GRAVE", "HURACÁN", "HURACAN")):
        return 4
    if any(k in hl for k in ("AMARILLO", "MODERADO", "FUERTE", "INTENSO", "INTENSA", "TORMENTA TROPICAL")):
        return 3
    return 2  # VERDE — default para boletín informativo


async def persist_smn_bulletin_if_new(db: AsyncSession, bulletin: dict, summarizer=None) -> bool:
    """
    Insert an SMN bulletin into the alerts table if it hasn't been persisted yet.
    Returns True when a new row was inserted, False when it already existed.
    SMN alerts have no specific lat/lon (national scope).

    `summarizer`, when given, is an async `str -> str | None` callable (see
    `ai.service.generate_plain_summary`) invoked once, only on a genuine new
    insert — not on every 30-min cycle the unchanged bulletin is re-fetched.
    Injected rather than imported directly so this module never pulls in the
    AI feature's heavy dependencies.
    """
    aviso_num = bulletin.get("aviso_num")
    if aviso_num:
        title = f"SMN Aviso #{aviso_num}"
        existing = await db.execute(
            text("SELECT id FROM alerts WHERE title = :title AND timestamp > NOW() - INTERVAL '26 hours'"),
            {"title": title},
        )
    else:
        headline = bulletin.get("headline") or ""
        title = f"SMN: {headline[:240]}"
        existing = await db.execute(
            text("SELECT id FROM alerts WHERE title = :title AND timestamp > NOW() - INTERVAL '4 hours'"),
            {"title": title},
        )

    existing_row = existing.mappings().first()
    if existing_row:
        pdf_url = bulletin.get("pdf_url")
        if pdf_url:
            await db.execute(
                text("UPDATE alerts SET pdf_url = :pdf_url WHERE id = :id AND pdf_url IS NULL"),
                {"pdf_url": pdf_url, "id": existing_row["id"]},
            )
            await db.commit()
            logger.debug("SMN bulletin pdf_url backfilled: '%s'", title)
        logger.debug("SMN bulletin already persisted: '%s'", title)
        return False

    level = _smn_headline_to_level(bulletin.get("headline") or "")
    short = (bulletin.get("summary") or bulletin.get("headline") or "Boletín del SMN/CONAGUA")[:500]

    ai_summary = None
    if summarizer is not None:
        full_text = bulletin.get("full_text") or bulletin.get("summary") or bulletin.get("headline")
        if full_text:
            try:
                ai_summary = await summarizer(full_text)
            except Exception as exc:
                logger.warning("SMN ai_summary generation failed for '%s': %s", title, exc)

    pdf_url = bulletin.get("pdf_url")
    await db.execute(
        text("""
            INSERT INTO alerts (level, score, title, short, lat, lon, factors, recommendations, pdf_url, ai_summary)
            VALUES (:level, 0, :title, :short, NULL, NULL, '[]', '[]', :pdf_url, :ai_summary)
        """),
        {"level": level, "title": title, "short": short, "pdf_url": pdf_url, "ai_summary": ai_summary},
    )
    await db.commit()
    logger.info(
        "SMN bulletin persisted: level=%d title='%s' has_ai_summary=%s",
        level, title, ai_summary is not None,
    )
    return True


async def persist_smn_cyclone_advisory_if_new(db: AsyncSession, advisory: dict) -> bool:
    """
    Insert an SMN cyclone advisory (Atlántico/Pacífico) into the alerts table
    if it hasn't been persisted yet. Mirrors persist_smn_bulletin_if_new — same
    table, same dedup-by-title-within-a-window strategy.
    """
    ocean_label = "Atlántico" if advisory.get("ocean") == "atlantico" else "Pacífico"
    system_name = advisory.get("system_name") or "Sistema ciclónico"
    aviso_num = advisory.get("aviso_num")
    title = f"SMN Ciclón {ocean_label}: {system_name}"
    if aviso_num:
        title += f" — Aviso #{aviso_num}"
    title = title[:255]

    existing = await db.execute(
        text("SELECT id FROM alerts WHERE title = :title AND timestamp > NOW() - INTERVAL '24 hours'"),
        {"title": title},
    )
    existing_row = existing.mappings().first()
    if existing_row:
        pdf_url = advisory.get("pdf_url")
        if pdf_url:
            await db.execute(
                text("UPDATE alerts SET pdf_url = :pdf_url WHERE id = :id AND pdf_url IS NULL"),
                {"pdf_url": pdf_url, "id": existing_row["id"]},
            )
            await db.commit()
        logger.debug("SMN cyclone advisory already persisted: '%s'", title)
        return False

    level = _smn_headline_to_level(advisory.get("synthesis") or system_name)
    short = (advisory.get("synthesis") or f"Aviso de ciclón tropical — {system_name}")[:500]

    factors = []
    if advisory.get("location_text"):
        factors.append(f"Distancia: {advisory['location_text']}")
    if advisory.get("wind_sustained_kmh") is not None:
        factors.append(f"Vientos sostenidos: {advisory['wind_sustained_kmh']:.0f} km/h")
    if advisory.get("wind_gusts_kmh") is not None:
        factors.append(f"Rachas: {advisory['wind_gusts_kmh']:.0f} km/h")
    if advisory.get("pressure_hpa") is not None:
        factors.append(f"Presión: {advisory['pressure_hpa']:.0f} hPa")
    if advisory.get("movement_text"):
        factors.append(f"Desplazamiento: {advisory['movement_text']}")

    recommendations = [advisory["recommendations"]] if advisory.get("recommendations") else []

    # Structured fields with no dedicated column — kept queryable/typed for
    # get_smn_cyclone_advisories() instead of re-parsing them back out of `factors`.
    cyclone_meta = {
        "ocean": advisory.get("ocean"),
        "system_name": system_name,
        "aviso_num": aviso_num,
        "location_text": advisory.get("location_text"),
        "movement_text": advisory.get("movement_text"),
        "wind_sustained_kmh": advisory.get("wind_sustained_kmh"),
        "wind_gusts_kmh": advisory.get("wind_gusts_kmh"),
        "pressure_hpa": advisory.get("pressure_hpa"),
    }

    await db.execute(
        text("""
            INSERT INTO alerts (level, score, title, short, lat, lon, factors, recommendations,
                                 pdf_url, cyclone_meta)
            VALUES (:level, 0, :title, :short, :lat, :lon,
                    CAST(:factors AS jsonb), CAST(:recommendations AS jsonb), :pdf_url,
                    CAST(:cyclone_meta AS jsonb))
        """),
        {
            "level": level, "title": title, "short": short,
            "lat": advisory.get("lat"), "lon": advisory.get("lon"),
            "factors": json.dumps(factors),
            "recommendations": json.dumps(recommendations),
            "pdf_url": advisory.get("pdf_url"),
            "cyclone_meta": json.dumps(cyclone_meta),
        },
    )
    await db.commit()
    logger.info("SMN cyclone advisory persisted: level=%d title='%s'", level, title)
    return True


async def get_alerts(db: AsyncSession, limit: int, offset: int):
    result = await db.execute(text("""SELECT id, timestamp, level, score, title, short, ai_summary
       FROM alerts
      ORDER BY timestamp DESC
      LIMIT :limit OFFSET :offset"""),
      {"limit": limit, "offset": offset})

    return result.mappings().all()


async def get_general_alerts_for_active(db: AsyncSession, limit: int):
    """
    System/admin alerts for the /active feed. Excludes SMN cyclone advisories
    (cyclone_meta IS NOT NULL) — those get their own dedicated section
    (see get_smn_cyclone_advisories) so they aren't shown twice.
    """
    result = await db.execute(
        text("""
            SELECT id, timestamp, level, score, title, short, ai_summary
            FROM alerts
            WHERE cyclone_meta IS NULL
            ORDER BY timestamp DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    return result.mappings().all()


async def get_smn_cyclone_advisories(db: AsyncSession) -> list[dict]:
    """
    Latest persisted SMN cyclone advisory per (ocean, system), within the last
    24h — older advisories for the same system are superseded, not "still active".
    """
    result = await db.execute(
        text("""
            SELECT DISTINCT ON (cyclone_meta->>'ocean', cyclone_meta->>'system_name')
                id, timestamp, level, title, short, lat, lon, pdf_url, recommendations, cyclone_meta
            FROM alerts
            WHERE cyclone_meta IS NOT NULL
              AND timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY cyclone_meta->>'ocean', cyclone_meta->>'system_name', timestamp DESC
        """)
    )
    rows = result.mappings().all()

    advisories = []
    for row in rows:
        meta = row["cyclone_meta"] or {}
        recs = row["recommendations"] or []
        advisories.append({
            "ocean": meta.get("ocean"),
            "system_name": meta.get("system_name"),
            "aviso_num": meta.get("aviso_num"),
            "level": row["level"],
            "synthesis": row["short"],
            "location_text": meta.get("location_text"),
            "lat": row["lat"],
            "lon": row["lon"],
            "movement_text": meta.get("movement_text"),
            "wind_sustained_kmh": meta.get("wind_sustained_kmh"),
            "wind_gusts_kmh": meta.get("wind_gusts_kmh"),
            "pressure_hpa": meta.get("pressure_hpa"),
            "recommendations": recs[0] if recs else None,
            "pdf_url": row["pdf_url"],
            "issued_at": row["timestamp"],
        })
    return advisories

async def get_alert_by_id(db: AsyncSession, id):
    result = await db.execute(text("SELECT * FROM alerts WHERE id = :id LIMIT 1"),
    {"id": id})
    return result.mappings().first()


async def create_alert(
    db: AsyncSession,
    level: int, score: int, title: str, short: str,
    lat: float, lon: float, factors: list, recommendations: list,
):
    result = await db.execute(
        text("""
            INSERT INTO alerts (level, score, title, short, lat, lon, factors, recommendations)
            VALUES (:level, :score, :title, :short, :lat, :lon,
                    CAST(:factors AS jsonb), CAST(:recommendations AS jsonb))
            RETURNING id, timestamp, level, score, title, short, lat, lon, factors, recommendations
        """),
        {
            "level": level, "score": score, "title": title, "short": short,
            "lat": lat, "lon": lon,
            "factors": json.dumps(factors),
            "recommendations": json.dumps(recommendations),
        },
    )
    await db.commit()
    return result.mappings().first()


async def get_user_siat_state(db: AsyncSession, user_id: int) -> dict | None:
    """
    Returns the user's current SIAT state joined with the latest assessment reason.
    The reason field contains cyclone name, distance, wind, and ETA — much more
    useful for the /active endpoint than a generic title.
    """
    result = await db.execute(
        text("""
            SELECT uas.current_level, uas.siat_color, uas.updated_at,
                   sa.reason, sa.distance_km, sa.eta_hours
            FROM user_alert_states uas
            LEFT JOIN siat_assessments sa
                ON sa.user_id = uas.user_id
                AND sa.cyclone_event_id = uas.active_cyclone_id
            WHERE uas.user_id = :uid
        """),
        {"uid": user_id},
    )
    return result.mappings().first()


async def get_alerts_with_siat(db: AsyncSession, user_id: int | None, limit: int, offset: int):
    alerts = await get_alerts(db, limit, offset)
    siat_level, siat_color = None, None

    if user_id is not None:
        row = await db.execute(
            text("SELECT current_level, siat_color FROM user_alert_states WHERE user_id = :uid"),
            {"uid": user_id},
        )
        state = row.mappings().first()
        if state:
            siat_level = state["current_level"]
            siat_color = state["siat_color"]

    return [{**dict(a), "siat_level": siat_level, "siat_color": siat_color} for a in alerts]


