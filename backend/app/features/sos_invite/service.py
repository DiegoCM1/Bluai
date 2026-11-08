import logging
import secrets

from fastapi import HTTPException
from firebase_admin import messaging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.users.service import FALLBACK_PUBLIC_NAME
from app.features.notifications.service import get_tokens_for_users, _send_multicast_with_retry, send_contacts_refresh_push, send_targeted_notification, build_apns_config

logger = logging.getLogger(__name__)

DEEP_LINK_BASE = "blueye://sos-invite"
# Known limitation: this is a bare custom scheme, not a universal/app link
# (app.json has no associatedDomains / autoVerify intent filter). If the invitee
# doesn't have BluEye installed, tapping a manually-shared share_url does nothing —
# there's no web fallback to the store and no deferred-deep-link resume after
# install. They have to install the app on their own, then re-tap the original
# share message. Fixing this needs a real deferred-deep-link setup (Firebase
# Dynamic Links, Branch.io, or a first-party https:// landing page + App Links),
# not a one-line patch.


_RESEND_COOLDOWN = "10 minutes"


async def create_invite(
    db: AsyncSession,
    inviter_id: int,
    inviter_display_name: str,
    contact_id: int,
) -> dict:
    # Match on the last 10 digits rather than an exact string: the contact's phone
    # comes verbatim from the device address book (may carry +52, dashes, spaces),
    # while the invitee's own phone was typed by hand during onboarding — an exact
    # match almost never survives that formatting gap, so invites silently fell
    # back to manual share instead of reaching an existing app user.
    contact = await db.execute(
        text("""
            SELECT sc.name, sc.link_status, sc.user_id, sc.phone, u.id AS invitee_user_id
            FROM sos_contacts sc
            LEFT JOIN users u ON
                length(regexp_replace(sc.phone, '[^0-9]', '', 'g')) >= 10
                AND right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 10)
                    = right(regexp_replace(sc.phone, '[^0-9]', '', 'g'), 10)
            WHERE sc.id = :id
        """),
        {"id": contact_id},
    )
    row = contact.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="SOS contact not found")
    if int(row["user_id"]) != inviter_id:
        raise HTTPException(status_code=403, detail="SOS contact does not belong to this user")
    if row["link_status"] == "linked":
        raise HTTPException(status_code=409, detail="Contact is already linked to an app user")

    # Re-sending is allowed (invites expire in 72h), but each one regenerates the link
    # and can push the invitee again — so not more than once per cooldown.
    recent = await db.execute(
        text(f"""
            SELECT 1 FROM sos_invitations
            WHERE contact_id = :contact_id
              AND accepted_at IS NULL
              AND revoked_at IS NULL
              AND created_at > NOW() - INTERVAL '{_RESEND_COOLDOWN}'
        """),
        {"contact_id": contact_id},
    )
    if recent.scalar() is not None:
        raise HTTPException(
            status_code=429,
            detail="Ya enviaste esta invitación hace poco. Espera unos minutos para reenviarla.",
        )

    token = secrets.token_urlsafe(32)
    result = await db.execute(
        text("""
            INSERT INTO sos_invitations
                (token, inviter_id, inviter_display_name, contact_id, contact_name)
            VALUES
                (:token, :inviter_id, :inviter_display_name, :contact_id, :contact_name)
            ON CONFLICT (contact_id) DO UPDATE SET
                token                = EXCLUDED.token,
                inviter_display_name = EXCLUDED.inviter_display_name,
                contact_name         = EXCLUDED.contact_name,
                expires_at           = NOW() + INTERVAL '72 hours',
                accepted_at          = NULL,
                accepted_user_id     = NULL,
                revoked_at           = NULL,
                created_at           = NOW()
            RETURNING token, expires_at
        """),
        {
            "token": token,
            "inviter_id": inviter_id,
            "inviter_display_name": inviter_display_name or FALLBACK_PUBLIC_NAME,
            "contact_id": contact_id,
            "contact_name": row["name"],
        },
    )
    await db.execute(
        text("UPDATE sos_contacts SET link_status = 'invite_sent' WHERE id = :id"),
        {"id": contact_id},
    )
    await db.commit()

    inv = result.mappings().first()
    invite_token = inv["token"]

    push_sent = False
    invitee_user_id = row["invitee_user_id"]
    if invitee_user_id is not None:
        push_sent = await _send_invite_push(
            db,
            invitee_user_id=int(invitee_user_id),
            inviter_display_name=inviter_display_name or FALLBACK_PUBLIC_NAME,
            contact_name=row["name"],
            invite_token=invite_token,
        )

    return {
        "share_url": f"{DEEP_LINK_BASE}/{invite_token}",
        "expires_at": inv["expires_at"],
        "push_sent": push_sent,
    }


async def _send_invite_push(
    db: AsyncSession,
    invitee_user_id: int,
    inviter_display_name: str,
    contact_name: str,
    invite_token: str,
) -> bool:
    token_map = await get_tokens_for_users(db, [invitee_user_id])
    tokens = token_map.get(invitee_user_id, [])
    if not tokens:
        return False

    msg = messaging.MulticastMessage(
        notification=messaging.Notification(
            title=f"Invitación SOS de {inviter_display_name}",
            body=f"Te invitan a ser contacto SOS de {inviter_display_name} en Bluai.",
        ),
        data={
            "category":             "sos_invite",
            "invite_token":         invite_token,
            "inviter_display_name": inviter_display_name,
            "contact_name":         contact_name,
        },
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                channel_id="sos_alerts",
            ),
        ),
        # Sin interruption-level: una invitación no es una emergencia.
        apns=build_apns_config(),
        tokens=tokens,
    )
    try:
        response = await _send_multicast_with_retry(msg)
        logger.info(
            "SOS invite push → invitee_user_id=%d tokens=%d success=%d failure=%d",
            invitee_user_id, len(tokens), response.success_count, response.failure_count,
        )
        return response.success_count > 0
    except Exception as exc:
        logger.error("SOS invite push failed invitee_user_id=%d: %s", invitee_user_id, exc)
        return False


async def get_invite_preview(db: AsyncSession, token: str) -> dict:
    result = await db.execute(
        text("""
            SELECT inviter_display_name, contact_name, expires_at,
                   (expires_at > NOW()) AS is_valid,
                   accepted_at, revoked_at
            FROM sos_invitations WHERE token = :token
        """),
        {"token": token},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not row["is_valid"] or row["revoked_at"] is not None:
        raise HTTPException(status_code=410, detail="Invitation expired or revoked")
    if row["accepted_at"] is not None:
        raise HTTPException(status_code=409, detail="Invitation already accepted")
    return {
        "inviter_display_name": row["inviter_display_name"] or FALLBACK_PUBLIC_NAME,
        "contact_name": row["contact_name"],
        "expires_at": row["expires_at"],
    }


async def accept_invite(db: AsyncSession, token: str, caller_user_id: int) -> dict:
    result = await db.execute(
        text("""
            SELECT id, inviter_id, inviter_display_name, contact_id, contact_name,
                   (expires_at > NOW()) AS is_valid,
                   accepted_at, revoked_at
            FROM sos_invitations WHERE token = :token
        """),
        {"token": token},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not row["is_valid"] or row["revoked_at"] is not None:
        raise HTTPException(status_code=410, detail="Invitation expired or revoked")
    if row["accepted_at"] is not None:
        raise HTTPException(status_code=409, detail="Invitation already accepted")
    if int(row["inviter_id"]) == caller_user_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own invitation")

    await db.execute(
        text("""
            UPDATE sos_contacts
            SET linked_user_id = :user_id, link_status = 'linked'
            WHERE id = :contact_id
        """),
        {"user_id": caller_user_id, "contact_id": row["contact_id"]},
    )
    await db.execute(
        text("""
            UPDATE sos_invitations
            SET accepted_at = NOW(), accepted_user_id = :user_id
            WHERE token = :token
        """),
        {"user_id": caller_user_id, "token": token},
    )
    await db.commit()

    # Notify both sides so their contacts screen refreshes instantly
    await send_contacts_refresh_push(db, [int(row["inviter_id"]), caller_user_id])

    return {
        "inviter_display_name": row["inviter_display_name"] or FALLBACK_PUBLIC_NAME,
        "contact_name": row["contact_name"],
    }


async def reject_invite(db: AsyncSession, token: str, caller_user_id: int) -> None:
    result = await db.execute(
        text("""
            SELECT id, inviter_id, inviter_display_name, contact_id, contact_name,
                   (expires_at > NOW()) AS is_valid,
                   accepted_at, revoked_at
            FROM sos_invitations WHERE token = :token
        """),
        {"token": token},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not row["is_valid"] or row["revoked_at"] is not None:
        raise HTTPException(status_code=410, detail="Invitation expired or revoked")
    if row["accepted_at"] is not None:
        raise HTTPException(status_code=409, detail="Invitation already accepted")
    if int(row["inviter_id"]) == caller_user_id:
        raise HTTPException(status_code=400, detail="Cannot reject your own invitation")

    # Revert contact to unlinked so the inviter can re-send
    await db.execute(
        text("UPDATE sos_contacts SET link_status = 'unlinked' WHERE id = :id"),
        {"id": row["contact_id"]},
    )
    # Invalidate the token (reuse revoked_at — same effect as expiry)
    await db.execute(
        text("UPDATE sos_invitations SET revoked_at = NOW() WHERE token = :token"),
        {"token": token},
    )
    await db.commit()

    # Notify the inviter: visible push + silent contacts refresh
    inviter_id = int(row["inviter_id"])
    contact_name = row["contact_name"] or "tu contacto"
    try:
        await send_targeted_notification(
            db,
            user_id=inviter_id,
            title="Invitación SOS rechazada",
            body=f"{contact_name} rechazó tu invitación SOS.",
            data={"category": "sos_rejected"},
            android_channel_id="sos_alerts",
        )
    except Exception:
        pass  # inviter may have no tokens; not critical
    await send_contacts_refresh_push(db, [inviter_id])
