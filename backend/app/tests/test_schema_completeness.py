"""
Schema-completeness guard.
The bug class: a feature queries a table that the startup hook never creates, so it works in an environment whose schema accrued from deploy history (prod) but blows up on a freshly-created database (staging, a teammate's local, this CI Postgres).

What it does: against a clean database, run the exact startup table-creation
functions (`ensure_core_tables` + `ensure_siat_tables`) and assert that every
table the app expects to exist actually got created. If someone adds a feature
that queries a new table but forgets to register its `CREATE TABLE` in the
startup hook, this goes red in CI instead of 500-ing in an environment.

Maintenance contract: when you add a `CREATE TABLE IF NOT EXISTS` to
`ensure_core_tables` (app/main.py) or `ensure_siat_tables`
(app/features/siat/service.py), add the table name to EXPECTED_TABLES below.

Runs against the Postgres service CI already provisions (DATABASE_URL). If no
database is reachable (e.g. a local run with no DB, or one that needs SSL we
don't configure here), the test skips rather than failing — its job is to gate
CI, not to require every developer to have a live DB.
"""
import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.main import ensure_core_tables
from app.features.siat.service import ensure_siat_tables

# Every table guaranteed to exist after the startup hooks run on a clean DB.
# Excluded on purpose:
#   - rag_chunks: created conditionally (needs the pgvector extension); skipped
#     by design where pgvector is unavailable, including this CI Postgres.
#   - map_event_votes: created lazily per-request by ensure_map_events_table(),
#     not by the startup hooks, so it is safe without being registered here.
EXPECTED_TABLES = {
    "users",
    "alerts",
    "device_tokens",
    "notification_preferences",
    "map_events",
    "sos_contacts",
    "sos_invitations",
    "sos_events",
    "feedback",
    "cyclone_events",
    "siat_assessments",
    "user_alert_states",
    "subscriptions",
    "subscription_events",
    "family_members",
}


# Columnas que una feature lee y que un ALTER del arranque tiene que haber creado.
# No es el esquema completo: es la lista de columnas cuya ausencia rompe algo en
# silencio. Las de perfil se agregaron después de `users`, así que solo existen si el
# ALTER correspondiente sigue en `ensure_core_tables` — y una tabla puede existir con
# columnas faltantes, que es justo el hueco que el guard de tablas no cubre.
#
# Contrato de mantenimiento: si agregas un ADD COLUMN del que dependa una feature,
# agrégalo aquí también.
EXPECTED_COLUMNS = {
    "subscriptions": {
        "billing_period", "payment_provider", "cancel_at_period_end",
        "stripe_customer_id", "stripe_subscription_id", "updated_at",
    },
    "users": {
        "phone", "display_name", "email",
        "first_name", "last_name", "address_1", "address_2",
        "zip_code", "state", "age_range",
    },
    "notification_preferences": {
        "quiet_hours_enabled", "quiet_start", "quiet_end",
        "nervousness_level", "weather_info_level",
    },
}


async def _existing_public_tables() -> set[str]:
    # Separate engine (not app.core.database.engine) because the app engine
    # forces ssl=require for Neon, which the plain CI Postgres doesn't speak.
    url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))  # fail fast if unreachable
    except Exception as exc:  # no DB reachable -> not this test's job to fail
        await engine.dispose()
        pytest.skip(f"no database reachable for schema check: {exc}")

    try:
        await ensure_core_tables(engine)
        await ensure_siat_tables(engine)
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            )
            tables = {r[0] for r in rows}
            cols = await conn.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public'"
                )
            )
            columns: dict[str, set[str]] = {}
            for table, column in cols:
                columns.setdefault(table, set()).add(column)
            return tables, columns
    finally:
        await engine.dispose()


def test_startup_hooks_create_every_expected_table():
    existing, _ = asyncio.run(_existing_public_tables())
    missing = EXPECTED_TABLES - existing
    assert not missing, (
        f"Startup hooks did not create these tables: {sorted(missing)}. "
        "Register their CREATE TABLE in ensure_core_tables/ensure_siat_tables "
        "(and add them to EXPECTED_TABLES if intentional)."
    )


def test_startup_hooks_create_every_expected_column():
    _, columns = asyncio.run(_existing_public_tables())
    missing = {
        table: sorted(expected - columns.get(table, set()))
        for table, expected in EXPECTED_COLUMNS.items()
        if expected - columns.get(table, set())
    }
    assert not missing, (
        f"Startup hooks did not create these columns: {missing}. "
        "Register their ALTER TABLE ... ADD COLUMN IF NOT EXISTS in ensure_core_tables "
        "(and update EXPECTED_COLUMNS if intentional)."
    )
