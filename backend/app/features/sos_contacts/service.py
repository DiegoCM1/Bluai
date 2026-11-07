from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.sos_contacts.schemas import SOSContactCreate, SOSContactUpdate
from app.features.notifications.service import send_contacts_refresh_push, send_targeted_notification


async def list_sos_contacts(db: AsyncSession, user_id: int) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT id, user_id, name, phone, relationship, linked_user_id, link_status, created_at, updated_at
            FROM sos_contacts
            WHERE user_id = :user_id
            ORDER BY created_at ASC
        """),
        {"user_id": user_id},
    )
    return [dict(row) for row in result.mappings().all()]


async def _ensure_phone_not_taken(
    db: AsyncSession, user_id: int, phone: str, exclude_contact_id: int = -1,
) -> None:
    """409 if this user already has a contact with the same number.

    Same rule as invite matching (`sos_invite/service.py`): the last 10 digits, so
    "+52 999 123 4567", "999-123-4567" and "9991234567" are one person. Numbers under
    10 digits compare in full. Without this, one contact could be added repeatedly —
    the SOS result would read "Ana, Ana" and Ana could be pushed twice.
    """
    result = await db.execute(
        text("""
            SELECT name FROM sos_contacts
            WHERE user_id = :user_id
              AND id <> :exclude_id
              AND CASE
                    WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
                     AND length(regexp_replace(:phone, '[^0-9]', '', 'g')) >= 10
                    THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
                       = right(regexp_replace(:phone, '[^0-9]', '', 'g'), 10)
                    ELSE regexp_replace(phone, '[^0-9]', '', 'g')
                       = regexp_replace(:phone, '[^0-9]', '', 'g')
                  END
            LIMIT 1
        """),
        {"user_id": user_id, "phone": phone, "exclude_id": exclude_contact_id},
    )
    existing = result.scalar()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_phone",
                "existing_name": existing,
                "message": f"Ya tienes a {existing} con ese número.",
            },
        )


async def create_sos_contact(db: AsyncSession, user_id: int, payload: SOSContactCreate) -> dict:
    await _ensure_phone_not_taken(db, user_id, payload.phone.strip())
    result = await db.execute(
        text("""
            INSERT INTO sos_contacts (user_id, name, phone, relationship)
            VALUES (:user_id, :name, :phone, :relationship)
            RETURNING id, user_id, name, phone, relationship, linked_user_id, link_status, created_at, updated_at
        """),
        {
            "user_id": user_id,
            "name": payload.name.strip(),
            "phone": payload.phone.strip(),
            "relationship": payload.relationship.strip() if payload.relationship else None,
        },
    )
    await db.commit()
    return dict(result.mappings().first())


async def update_sos_contact(db: AsyncSession, contact_id: int, user_id: int, payload: SOSContactUpdate) -> dict:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        row = await _get_contact_owned_by(db, contact_id, user_id)
        return row

    if "name" in updates:
        updates["name"] = updates["name"].strip()
    if "phone" in updates:
        updates["phone"] = updates["phone"].strip()
        await _ensure_phone_not_taken(db, user_id, updates["phone"], exclude_contact_id=contact_id)
    if "relationship" in updates:
        updates["relationship"] = updates["relationship"].strip() if updates["relationship"] else None

    set_clause = ", ".join(f"{col} = :{col}" for col in updates)
    result = await db.execute(
        text(f"""
            UPDATE sos_contacts
            SET {set_clause}, updated_at = NOW()
            WHERE id = :contact_id AND user_id = :user_id
            RETURNING id, user_id, name, phone, relationship, linked_user_id, link_status, created_at, updated_at
        """),
        {**updates, "contact_id": contact_id, "user_id": user_id},
    )
    await db.commit()
    row = result.mappings().first()
    if row:
        return dict(row)

    await _raise_not_found_or_forbidden(db, contact_id, user_id)


async def delete_sos_contact(db: AsyncSession, contact_id: int, user_id: int) -> None:
    result = await db.execute(
        text("DELETE FROM sos_contacts WHERE id = :id AND user_id = :user_id RETURNING id, linked_user_id, link_status"),
        {"id": contact_id, "user_id": user_id},
    )
    await db.commit()
    row = result.mappings().first()
    if row:
        if row["link_status"] == "linked" and row["linked_user_id"]:
            await send_contacts_refresh_push(db, [int(row["linked_user_id"])])
        return
    await _raise_not_found_or_forbidden(db, contact_id, user_id)


async def get_who_has_me(db: AsyncSession, user_id: int) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT sc.name, sc.relationship, sc.created_at,
                   u.id AS owner_user_id,
                   u.display_name AS owner_display_name,
                   u.phone AS owner_phone,
                   EXISTS (
                       SELECT 1 FROM sos_contacts ec
                       WHERE ec.user_id = :user_id AND ec.linked_user_id = u.id
                   ) AS already_my_contact
            FROM sos_contacts sc
            JOIN users u ON u.id = sc.user_id
            WHERE sc.linked_user_id = :user_id AND sc.link_status = 'linked'
            ORDER BY sc.created_at ASC
        """),
        {"user_id": user_id},
    )
    return [dict(row) for row in result.mappings().all()]


async def add_reciprocal_contact(db: AsyncSession, current_user_id: int, owner_user_id: int) -> dict:
    if current_user_id == owner_user_id:
        raise HTTPException(status_code=400, detail="Cannot add yourself as a contact")

    exists = await db.execute(
        text("SELECT id FROM sos_contacts WHERE user_id = :uid AND linked_user_id = :linked"),
        {"uid": current_user_id, "linked": owner_user_id},
    )
    if exists.mappings().first():
        raise HTTPException(status_code=409, detail="Already have this user as a contact")

    # Fetch both users in parallel queries
    owner = await db.execute(
        text("SELECT display_name, phone FROM users WHERE id = :id"),
        {"id": owner_user_id},
    )
    owner_row = owner.mappings().first()
    if not owner_row:
        raise HTTPException(status_code=404, detail="User not found")

    adder = await db.execute(
        text("SELECT display_name FROM users WHERE id = :id"),
        {"id": current_user_id},
    )
    adder_row = adder.mappings().first()
    adder_name = (adder_row["display_name"] if adder_row else None) or "Tu contacto"

    result = await db.execute(
        text("""
            INSERT INTO sos_contacts (user_id, name, phone, link_status, linked_user_id)
            VALUES (:user_id, :name, :phone, 'linked', :linked_user_id)
            RETURNING id, user_id, name, phone, relationship, linked_user_id, link_status, created_at, updated_at
        """),
        {
            "user_id": current_user_id,
            "name": owner_row["display_name"] or "Contacto SOS",
            "phone": owner_row["phone"] or "",
            "linked_user_id": owner_user_id,
        },
    )
    await db.commit()
    contact = dict(result.mappings().first())

    # Notify the owner (Xiaomi) with a visible banner push + silent UI refresh
    try:
        await send_targeted_notification(
            db,
            user_id=owner_user_id,
            title="Nuevo contacto SOS",
            body=f"{adder_name} te agregó como contacto SOS.",
            data={"category": "sos_contact_added", "adder_display_name": adder_name},
            android_channel_id="sos_alerts",
        )
    except Exception:
        pass  # owner may have no tokens; not critical
    await send_contacts_refresh_push(db, [owner_user_id])
    return contact


async def _get_contact_owned_by(db: AsyncSession, contact_id: int, user_id: int) -> dict:
    result = await db.execute(
        text("""
            SELECT id, user_id, name, phone, relationship, linked_user_id, link_status, created_at, updated_at
            FROM sos_contacts WHERE id = :id AND user_id = :user_id
        """),
        {"id": contact_id, "user_id": user_id},
    )
    row = result.mappings().first()
    if not row:
        await _raise_not_found_or_forbidden(db, contact_id, user_id)
    return dict(row)


async def _raise_not_found_or_forbidden(db: AsyncSession, contact_id: int, user_id: int) -> None:
    exists = await db.execute(
        text("SELECT user_id FROM sos_contacts WHERE id = :id"),
        {"id": contact_id},
    )
    row = exists.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="SOS contact not found")
    raise HTTPException(status_code=403, detail="SOS contact does not belong to this user")
