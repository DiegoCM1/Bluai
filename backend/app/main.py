from fastapi import FastAPI, Depends, HTTPException
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import engine, get_db, AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession, AsyncEngine
from sqlalchemy import text
from app.features.alerts.router import router as alerts_router
from app.features.feedback.router import router as feedback_router
from app.features.notifications.router import router as notifications_router
from app.features.map_events.router import router as map_events_router
from app.features.siat.router import router as siat_router
from app.features.users.router import router as users_router
from app.features.notification_preferences.router import router as notification_preferences_router
from app.features.sos_contacts.router import router as sos_contacts_router
from app.features.sos_invite.router import router as sos_invite_router
from app.features.sos_trigger.router import router as sos_trigger_router
from app.features.payments.router import router as payments_router
from app.features.siat.service import ensure_siat_tables, run_cycle
from app.features.alerts.providers.smn import fetch_latest_bulletin
from app.features.alerts.providers.smn_ciclon import fetch_active_advisories
from app.features.alerts.service import persist_smn_bulletin_if_new, persist_smn_cyclone_advisory_if_new
import app.core.firebase
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# The AI router is imported optionally because it drags in sentence-transformers
# (~1GB of torch). If that import fails in production the feature disappears
# silently — the app boots fine and /ai/chat just 404s — so log the reason.
try:
    from app.features.ai.router import router as ai_router
    from app.features.ai.service import generate_plain_summary
except Exception:
    logger.exception("AI router import failed; /ai/chat and /api/v1/ai/alert-summary will 404")
    ai_router = None
    generate_plain_summary = None

SIAT_CYCLE_INTERVAL_SECONDS = 30 * 60  # 30 minutes


async def ensure_core_tables(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id          BIGSERIAL PRIMARY KEY,
                firebase_uid TEXT UNIQUE NOT NULL,
                lat         DOUBLE PRECISION,
                lon         DOUBLE PRECISION,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS alerts (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                level           INT NOT NULL,
                score           INT NOT NULL DEFAULT 0,
                title           VARCHAR(255) NOT NULL,
                short           VARCHAR(500) NOT NULL,
                lat             DOUBLE PRECISION,
                lon             DOUBLE PRECISION,
                factors         JSONB NOT NULL DEFAULT '[]',
                recommendations JSONB NOT NULL DEFAULT '[]'
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS device_tokens (
                id          SERIAL PRIMARY KEY,
                token       TEXT UNIQUE NOT NULL,
                user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS platform TEXT"
        ))
        # Backfill de una sola vez: hasta el primer build de iOS, TODO token en la
        # tabla es de Android por construcción (iOS nunca se ha publicado). Un token
        # de registro de FCM es opaco e idéntico entre plataformas, así que esta
        # clasificación es imposible de recuperar después — hay que hacerla mientras
        # los datos siguen siendo homogéneos.
        #
        # El `NOT EXISTS` lo apaga solo: en cuanto UN cliente reporte su plataforma,
        # los datos dejan de ser homogéneos y el backfill no vuelve a correr nunca.
        # Sin eso, correría en cada arranque y etiquetaría como "android" cualquier
        # token de iOS que llegara sin plataforma.
        await conn.execute(text("""
            UPDATE device_tokens SET platform = 'android'
            WHERE platform IS NULL
              AND NOT EXISTS (SELECT 1 FROM device_tokens WHERE platform IS NOT NULL)
        """))
        await conn.execute(text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS pdf_url TEXT"
        ))
        await conn.execute(text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS cyclone_meta JSONB"
        ))
        # Resumen en lenguaje llano del boletín SMN, generado una sola vez al
        # persistir el boletín (no en cada request) — lo usan el push y las
        # tarjetas de alerta en vez del texto crudo scrapeado del HTML oficial.
        await conn.execute(text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ai_summary TEXT"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)"
        ))
        # Perfil del onboarding. El wizard captura diez campos y hasta ahora solo el
        # teléfono llegaba al servidor (y ese, sin confirmar) — los otros nueve morían
        # en el AsyncStorage del dispositivo. Todos van en `users` y no en una tabla
        # aparte porque son 1:1 con la cuenta y se leen siempre junto con ella.
        #
        # `first_name`/`last_name` son la fuente de verdad del nombre; `display_name`
        # (que viene del token de Firebase) queda como respaldo cuando el usuario nunca
        # pasó por el wizard.
        await conn.execute(text("""
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100),
                ADD COLUMN IF NOT EXISTS address_1  VARCHAR(255),
                ADD COLUMN IF NOT EXISTS address_2  VARCHAR(255),
                ADD COLUMN IF NOT EXISTS zip_code   VARCHAR(10),
                ADD COLUMN IF NOT EXISTS state      VARCHAR(60),
                ADD COLUMN IF NOT EXISTS age_range  VARCHAR(10)
        """))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notification_preferences (
                user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                siat_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
                min_siat_level     INT     NOT NULL DEFAULT 2,
                map_events_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_start TIME"
        ))
        await conn.execute(text(
            "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_end TIME"
        ))
        # Los dos sliders del onboarding viven aquí y no en `users`: son personalización
        # de alertas, que es justo lo que esta tabla ya gobierna. Partirlos entre dos
        # tablas es como una feature termina construida contra la mitad equivocada.
        # DEFAULT 5 = el mismo valor inicial que el wizard muestra (`_types.ts`).
        await conn.execute(text(
            "ALTER TABLE notification_preferences "
            "ADD COLUMN IF NOT EXISTS nervousness_level SMALLINT NOT NULL DEFAULT 5"
        ))
        await conn.execute(text(
            "ALTER TABLE notification_preferences "
            "ADD COLUMN IF NOT EXISTS weather_info_level SMALLINT NOT NULL DEFAULT 5"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS map_events (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
                type        VARCHAR(20) NOT NULL CHECK (type IN ('natural', 'vial', 'peligro', 'ayuda')),
                description TEXT NOT NULL,
                lat         DOUBLE PRECISION NOT NULL,
                lon         DOUBLE PRECISION NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sos_contacts (
                id           BIGSERIAL PRIMARY KEY,
                user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name         VARCHAR(100) NOT NULL,
                phone        VARCHAR(30) NOT NULL,
                relationship VARCHAR(60),
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS sos_contacts_user_id_idx ON sos_contacts (user_id, created_at ASC)"
        ))
        await conn.execute(text(
            "ALTER TABLE sos_contacts ADD COLUMN IF NOT EXISTS linked_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE sos_contacts ADD COLUMN IF NOT EXISTS link_status VARCHAR(20) NOT NULL DEFAULT 'unlinked'"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sos_invitations (
                id                   BIGSERIAL PRIMARY KEY,
                token                VARCHAR(64) UNIQUE NOT NULL,
                inviter_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                inviter_display_name VARCHAR(200),
                contact_id           BIGINT NOT NULL REFERENCES sos_contacts(id) ON DELETE CASCADE,
                contact_name         VARCHAR(100) NOT NULL,
                expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
                accepted_at          TIMESTAMPTZ,
                accepted_user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
                revoked_at           TIMESTAMPTZ,
                created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT sos_inv_contact_unique UNIQUE (contact_id)
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS sos_invitations_token_idx ON sos_invitations (token)"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sos_events (
                id             BIGSERIAL PRIMARY KEY,
                sender_id      BIGINT NOT NULL REFERENCES users(id),
                lat            DOUBLE PRECISION,
                lon            DOUBLE PRECISION,
                notified_count INT NOT NULL DEFAULT 0,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        # `CREATE TABLE IF NOT EXISTS` protege la TABLA, no sus columnas: donde
        # `sos_events` ya existía, Postgres se salta el statement completo y jamás
        # compara el esquema. Prod creó esta tabla con una forma vieja (la de
        # `future_integration/sos/service.py`, sin `notified_count`), así que el
        # INSERT de `trigger_sos` llevaba meses tirando 500 —
        # UndefinedColumnError— mientras staging, CI y cada local pasaban: ahí la
        # base nace limpia y el CREATE sí corre.
        #
        # Por eso una columna nueva necesita SIEMPRE su ALTER además del CREATE.
        # El CREATE describe bases nuevas; el ALTER, las que ya existen.
        # `test_schema_completeness.py` no puede ver este hueco: corre contra una
        # base limpia, donde el cuerpo del CREATE siempre produce la columna.
        await conn.execute(text(
            "ALTER TABLE sos_events ADD COLUMN IF NOT EXISTS notified_count INT NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS sos_events_sender_idx ON sos_events (sender_id, created_at DESC)"
        ))
        # `sos_events.sender_id` se creó sin ON DELETE, o sea NO ACTION: borrar un
        # usuario que alguna vez mandó un SOS fallaba con violación de FK. Eso rompe
        # el borrado de cuenta (Guideline 5.1.1(v)) **solo para algunos usuarios**, que
        # es la peor variante: pasa la prueba manual con una cuenta recién creada.
        #
        # CASCADE es lo correcto: un sos_event guarda lat/lon del usuario, o sea que es
        # dato personal suyo y se va con la cuenta. El `confdeltype <> 'c'` hace que
        # esto solo corra mientras la constraint aún no sea CASCADE.
        await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'sos_events_sender_id_fkey' AND confdeltype <> 'c'
                ) THEN
                    ALTER TABLE sos_events DROP CONSTRAINT sos_events_sender_id_fkey;
                    ALTER TABLE sos_events ADD CONSTRAINT sos_events_sender_id_fkey
                        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
                END IF;
            END $$;
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS sos_contacts_linked_uid_idx "
            "ON sos_contacts (linked_user_id) WHERE linked_user_id IS NOT NULL"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id                      BIGSERIAL PRIMARY KEY,
                user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan_slug               VARCHAR(20) NOT NULL DEFAULT 'free',
                stripe_customer_id      VARCHAR(100),
                stripe_subscription_id  VARCHAR(100),
                status                  VARCHAR(20) NOT NULL DEFAULT 'active',
                current_period_end      TIMESTAMPTZ,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT subscriptions_user_unique UNIQUE (user_id)
            )
        """))
        await conn.execute(text(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_period VARCHAR(10) NOT NULL DEFAULT 'monthly'"
        ))
        await conn.execute(text(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20)"
        ))
        await conn.execute(text(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS web_checkouts (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                request_id VARCHAR(36) NOT NULL,
                session_id VARCHAR(100),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS subscription_events (
                id                BIGSERIAL PRIMARY KEY,
                user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
                provider          VARCHAR(20) NOT NULL,
                event_type        VARCHAR(100) NOT NULL,
                provider_event_id VARCHAR(255) UNIQUE,
                processing_status VARCHAR(20) NOT NULL DEFAULT 'processing',
                plan_slug         VARCHAR(20),
                billing_period    VARCHAR(10),
                amount_cents      INTEGER,
                currency          VARCHAR(10),
                details           JSONB NOT NULL DEFAULT '{}'::jsonb,
                occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                processed_at      TIMESTAMPTZ
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS subscription_events_user_idx "
            "ON subscription_events (user_id, occurred_at DESC)"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS family_members (
                id              BIGSERIAL PRIMARY KEY,
                owner_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                member_user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT family_members_unique UNIQUE (owner_user_id, member_user_id),
                CONSTRAINT family_members_not_self CHECK (owner_user_id <> member_user_id)
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS family_members_owner_idx ON family_members (owner_user_id)"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS feedback (
                id         BIGSERIAL PRIMARY KEY,
                rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                email      VARCHAR(320),
                message    TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

    # RAG retrieval table (pgvector). Isolated in its OWN transaction with a
    # guard: pgvector is a non-default extension, so if it's unavailable in some
    # environment, we log and continue instead of poisoning the core-table
    # transaction or crashing startup. The table is read by features/ai/rag.py;
    # embedding dim 384 matches the paraphrase-multilingual-MiniLM-L12-v2 model.
    # Data is loaded out-of-band (copied from prod) — see docs/STAGING.md.
    try:
        async with engine.begin() as conn:
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS vector'))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    id        BIGSERIAL PRIMARY KEY,
                    text      TEXT NOT NULL,
                    embedding vector(384)
                )
            """))
    except Exception as exc:
        logger.warning("ensure_core_tables: rag_chunks/pgvector setup skipped: %s", exc)


async def _siat_background_loop():
    """Runs SIAT evaluation cycle every SIAT_CYCLE_INTERVAL_SECONDS."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                bulletin = await fetch_latest_bulletin()
                if bulletin:
                    inserted = await persist_smn_bulletin_if_new(
                        db, bulletin, summarizer=generate_plain_summary
                    )
                    if inserted:
                        logger.info(
                            "SMN: new bulletin persisted — '%s'",
                            (bulletin.get("headline") or "")[:60],
                        )

                for ocean in ("atlantico", "pacifico"):
                    try:
                        advisories = await fetch_active_advisories(ocean)
                        for advisory in advisories:
                            inserted = await persist_smn_cyclone_advisory_if_new(db, advisory)
                            if inserted:
                                logger.info(
                                    "SMN: new cyclone advisory persisted — ocean=%s system=%s",
                                    ocean, advisory.get("system_name"),
                                )
                    except Exception:
                        logger.exception("SMN cyclone advisory cycle failed (ocean=%s)", ocean)

                result = await run_cycle(db)
                logger.info(
                    "SIAT background cycle: cyclones=%d users=%d notif=%d",
                    result["cyclones_found"],
                    result["users_evaluated"],
                    result["notifications_sent"],
                )
        except Exception:
            logger.exception("SIAT background cycle failed")
        await asyncio.sleep(SIAT_CYCLE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_core_tables(engine)
    await ensure_siat_tables(engine)
    siat_task = asyncio.create_task(_siat_background_loop())
    yield
    siat_task.cancel()
    await engine.dispose()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health of the app
@app.get("/health")
def get_health():
    return {
        "status": "OK",
        "timestamp": datetime.now(),
        "message": "Backend running",
    }

# Health of db
@app.get("/health-db")
async def get_db_health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "OK", "db": "reachable"}
    except Exception:
        raise HTTPException(status_code=500, detail="Database unreachable")


app.include_router(alerts_router)
app.include_router(feedback_router)
app.include_router(notifications_router)
if ai_router is not None:
    app.include_router(ai_router)
app.include_router(siat_router)
app.include_router(map_events_router)
app.include_router(users_router)
app.include_router(notification_preferences_router)
app.include_router(sos_contacts_router)
app.include_router(sos_invite_router)
app.include_router(sos_trigger_router)
app.include_router(payments_router)
