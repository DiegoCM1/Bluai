from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_ALL_FIELDS = (
    "id, firebase_uid, display_name, email, phone, lat, lon, created_at, updated_at, "
    "first_name, last_name, address_1, address_2, zip_code, state, age_range"
)

# Nombre que ven OTRAS personas (push de SOS, invitaciones) cuando no hay ninguno.
FALLBACK_PUBLIC_NAME = "Un usuario de Bluai"


def public_display_name(db_user, token_name: str | None = None) -> str:
    """El nombre con el que otra persona reconoce a este usuario.

    Orden: nombre del onboarding (`first_name`/`last_name`, la fuente de verdad) →
    `display_name` (del token al registrarse) → el claim `name` del token actual →
    genérico. Sign in with Apple no manda `name` en el token, así que sin el primer
    paso un SOS de un usuario de Apple llegaba como "Un usuario de BluEye".
    """
    full = " ".join(
        part.strip() for part in (db_user.get("first_name"), db_user.get("last_name"))
        if part and part.strip()
    )
    for candidate in (full, db_user.get("display_name"), token_name):
        if candidate and candidate.strip():
            return candidate.strip()
    return FALLBACK_PUBLIC_NAME


# Columnas de `users` que el perfil del onboarding puede escribir. Es una lista blanca,
# no documentación: los nombres de columna se interpolan en el SQL (no se pueden pasar
# como parámetro), así que esto es lo que garantiza que solo entren identificadores que
# nosotros elegimos, sin importar qué llegue del cliente.
_PROFILE_COLUMNS = (
    "first_name",
    "last_name",
    "phone",
    "address_1",
    "address_2",
    "zip_code",
    "state",
    "age_range",
)


async def get_user_by_firebase_uid(db: AsyncSession, firebase_uid: str) -> dict | None:
    # LEFT JOIN porque los dos sliders viven en `notification_preferences` y la fila de
    # preferencias se crea perezosamente: un usuario que nunca tocó Ajustes no tiene
    # una. El COALESCE devuelve el mismo default que `_DEFAULTS` en el servicio de
    # preferencias, para que la app no vea None donde el resto del sistema ya asume 5.
    qualified = ", ".join(f"u.{c.strip()}" for c in _ALL_FIELDS.split(","))
    result = await db.execute(
        text(f"""
            SELECT {qualified},
                   COALESCE(np.nervousness_level, 5)  AS nervousness_level,
                   COALESCE(np.weather_info_level, 5) AS weather_info_level
            FROM users u
            LEFT JOIN notification_preferences np ON np.user_id = u.id
            WHERE u.firebase_uid = :uid
            LIMIT 1
        """),
        {"uid": firebase_uid},
    )
    return result.mappings().first()


async def upsert_user(
    db: AsyncSession,
    firebase_uid: str,
    display_name: str | None = None,
    email: str | None = None,
) -> dict:
    """Create or update user profile from Firebase token. Idempotent."""
    result = await db.execute(
        text(f"""
            INSERT INTO users (firebase_uid, display_name, email)
            VALUES (:uid, :display_name, :email)
            ON CONFLICT (firebase_uid) DO UPDATE
                SET updated_at    = NOW(),
                    display_name  = COALESCE(EXCLUDED.display_name, users.display_name),
                    email         = COALESCE(EXCLUDED.email, users.email)
            RETURNING {_ALL_FIELDS}
        """),
        {"uid": firebase_uid, "display_name": display_name, "email": email},
    )
    await db.commit()
    return result.mappings().first()


async def update_user_profile(
    db: AsyncSession,
    firebase_uid: str,
    updates: dict,
    commit: bool = True,
) -> dict | None:
    """Escribe el perfil del onboarding en `users`.

    Solo toca las claves presentes en `updates`: un payload parcial no debe borrar una
    columna que el cliente no mandó. `commit=False` deja la transacción abierta para que
    quien llama pueda escribir también las preferencias y cerrar UNA sola vez — que es
    lo que impide el estado a medias ("se guardó el teléfono pero no la dirección").
    """
    fields = {k: v for k, v in updates.items() if k in _PROFILE_COLUMNS}

    if not fields:
        # Nada que escribir en `users` (p. ej. un payload que solo trae sliders). No es
        # un error: devolvemos el perfil actual para que la respuesta sea la misma.
        return await get_user_by_firebase_uid(db, firebase_uid)

    assignments = ", ".join(f"{col} = :{col}" for col in fields)
    result = await db.execute(
        text(f"""
            UPDATE users SET {assignments}, updated_at = NOW()
            WHERE firebase_uid = :uid
            RETURNING id
        """),
        {"uid": firebase_uid, **fields},
    )
    if result.first() is None:
        return None
    if commit:
        await db.commit()
    return await get_user_by_firebase_uid(db, firebase_uid)


async def update_user_phone(db: AsyncSession, firebase_uid: str, phone: str) -> dict | None:
    result = await db.execute(
        text(f"""
            UPDATE users SET phone = :phone, updated_at = NOW()
            WHERE firebase_uid = :uid
            RETURNING {_ALL_FIELDS}
        """),
        {"uid": firebase_uid, "phone": phone},
    )
    await db.commit()
    return result.mappings().first()


async def update_user_location(db: AsyncSession, firebase_uid: str, lat: float, lon: float) -> dict | None:
    result = await db.execute(
        text(f"""
            UPDATE users SET lat = :lat, lon = :lon, updated_at = NOW()
            WHERE firebase_uid = :uid
            RETURNING {_ALL_FIELDS}
        """),
        {"uid": firebase_uid, "lat": lat, "lon": lon},
    )
    await db.commit()
    return result.mappings().first()


async def delete_user_by_firebase_uid(db: AsyncSession, firebase_uid: str) -> bool:
    """Borra la fila de `users`. Devuelve True si existía.

    Todo lo demás cuelga de esto por FK: `device_tokens`, `notification_preferences`,
    `sos_contacts`, `sos_invitations` y `sos_events` van en cascada. Los push tokens
    son los que importan para la Guideline 5.1.1(v) — mientras esa fila viva, una
    cuenta "borrada" **sigue recibiendo alertas de huracán**.
    """
    result = await db.execute(
        text("DELETE FROM users WHERE firebase_uid = :uid RETURNING id"),
        {"uid": firebase_uid},
    )
    deleted = result.first() is not None
    await db.commit()
    return deleted
