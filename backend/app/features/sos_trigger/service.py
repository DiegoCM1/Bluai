import asyncio
import logging

from fastapi import HTTPException
from firebase_admin import messaging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.notifications.service import get_tokens_for_users, _send_multicast_with_retry, build_apns_config, summarize_push_failures

logger = logging.getLogger(__name__)

_RATE_LIMIT_MAX = 3
_RATE_LIMIT_WINDOW = "10 minutes"


async def trigger_sos(
    db: AsyncSession,
    sender_id: int,
    sender_display_name: str,
    lat: float | None,
    lon: float | None,
) -> dict:
    # 1. Rate limit: max 3 triggers per 10 minutes
    count_row = await db.execute(
        text(f"""
            SELECT COUNT(*) FROM sos_events
            WHERE sender_id = :sender_id
              AND created_at > NOW() - INTERVAL '{_RATE_LIMIT_WINDOW}'
        """),
        {"sender_id": sender_id},
    )
    if count_row.scalar() >= _RATE_LIMIT_MAX:
        oldest_row = await db.execute(
            text(f"""
                SELECT GREATEST(0, EXTRACT(EPOCH FROM
                    (MIN(created_at) + INTERVAL '{_RATE_LIMIT_WINDOW}' - NOW()))::int)
                FROM sos_events
                WHERE sender_id = :sender_id
                  AND created_at > NOW() - INTERVAL '{_RATE_LIMIT_WINDOW}'
            """),
            {"sender_id": sender_id},
        )
        retry_after = int(oldest_row.scalar() or 600)
        raise HTTPException(
            status_code=429,
            detail="Demasiadas alertas SOS. Espera unos minutos antes de enviar otra.",
            headers={"Retry-After": str(retry_after)},
        )

    # 2. Sender phone (included in push so receiver can call back)
    phone_row = await db.execute(
        text("SELECT phone FROM users WHERE id = :sender_id"),
        {"sender_id": sender_id},
    )
    sender_phone: str = phone_row.scalar() or ""

    # 3. ALL of the sender's contacts. Only linked ones can receive the push, but the
    #    rest are read too so the response can say exactly who did NOT get the alert.
    contacts_result = await db.execute(
        text("""
            SELECT name, link_status, linked_user_id FROM sos_contacts
            WHERE user_id = :sender_id
            ORDER BY created_at, id
        """),
        {"sender_id": sender_id},
    )
    contacts = [dict(row) for row in contacts_result.mappings()]
    linked_user_ids: list[int] = sorted({
        int(c["linked_user_id"]) for c in contacts
        if c["link_status"] == "linked" and c["linked_user_id"] is not None
    })

    token_map: dict[int, list[str]] = {}
    notified_user_ids: set[int] = set()
    skipped_count = 0

    if linked_user_ids:
        # 4. Device tokens. `token_owners[i]` is the user behind `all_tokens[i]` — the
        #    multicast response is index-aligned with the tokens sent, which is how a
        #    per-device result becomes a per-contact one.
        token_map = await get_tokens_for_users(db, linked_user_ids)
        token_owners = [uid for uid, tokens in token_map.items() for _ in tokens]
        all_tokens = [t for tokens in token_map.values() for t in tokens]
        skipped_count = len([uid for uid in linked_user_ids if uid not in token_map])

        # 5. Firebase push
        if all_tokens:
            display_name = sender_display_name or "Un usuario de BluEye"
            msg = messaging.MulticastMessage(
                notification=messaging.Notification(
                    title=f"🆘 SOS — {display_name}",
                    body="Necesita ayuda urgente. Toca para ver su ubicación.",
                ),
                data={
                    "category":     "sos",
                    "sender_name":  display_name,
                    "sender_phone": sender_phone,
                    "lat":         str(lat) if lat is not None else "",
                    "lon":         str(lon) if lon is not None else "",
                },
                android=messaging.AndroidConfig(
                    priority="high",
                    notification=messaging.AndroidNotification(
                        channel_id="sos_emergency",
                        default_vibrate_timings=False,
                        vibrate_timings_millis=[0, 250, 250, 250],
                    ),
                ),
                # Ya traía sonido; le faltaba poder atravesar Focus / No Molestar,
                # que es justo cuando un SOS importa más.
                apns=build_apns_config(interruption_level="time-sensitive"),
                tokens=all_tokens,
            )
            try:
                response = await _send_multicast_with_retry(msg)
                # A contact counts as notified if ANY of their devices accepted it.
                notified_user_ids = {
                    token_owners[i] for i, r in enumerate(response.responses) if r.success
                }
                logger.info(
                    "SOS push → sender_id=%d contacts=%d tokens=%d success=%d failure=%d",
                    sender_id, len(linked_user_ids), len(all_tokens),
                    response.success_count, response.failure_count,
                )
                if response.failure_count:
                    logger.warning(
                        "SOS push failures sender_id=%d: %s",
                        sender_id, summarize_push_failures(response),
                    )
            except Exception as exc:
                # Firebase failed after retries — nobody counts as notified.
                # Rate limit is consumed by design (see comment at step 5).
                logger.error("SOS Firebase push failed after retries sender_id=%d: %s", sender_id, exc, exc_info=True)

    # People, not devices: a contact with two phones is one person notified.
    notified_count = len(notified_user_ids)

    # 5. Log event (always — rate limit applies even to failed pushes)
    event_result = await db.execute(
        text("""
            INSERT INTO sos_events (sender_id, lat, lon, notified_count)
            VALUES (:sender_id, :lat, :lon, :notified_count)
            RETURNING id
        """),
        {
            "sender_id": sender_id,
            "lat": lat,
            "lon": lon,
            "notified_count": notified_count,
        },
    )
    await db.commit()
    sos_event_id = int(event_result.scalar())

    return {
        "notified_count": notified_count,
        "skipped_count":  skipped_count,
        "sos_event_id":   sos_event_id,
        "contacts": [
            {"name": c["name"], "status": _contact_status(c, token_map, notified_user_ids)}
            for c in contacts
        ],
    }


def _contact_status(
    contact: dict,
    token_map: dict[int, list[str]],
    notified_user_ids: set[int],
) -> str:
    """Why this contact did or didn't get the SOS — see `SOSContactStatus`."""
    if contact["link_status"] == "linked" and contact["linked_user_id"] is not None:
        uid = int(contact["linked_user_id"])
        if uid in notified_user_ids:
            return "notified"
        if uid not in token_map:
            return "no_device"
        return "failed"
    if contact["link_status"] == "invite_sent":
        return "invite_pending"
    return "not_linked"
