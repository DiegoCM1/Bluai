# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bluai — hurricane early-warning platform. React Native (Expo) **mobile** app + FastAPI backend. Real-time weather alerts, AI-assisted emergency chat (on-device + online), offline support. **Mobile only — web is not a supported target** (legacy `.web.*` files and web deps exist but are being removed; do not add new ones). See `frontend/CLAUDE.md`.

- `frontend/` — Expo app. Frontend-specific conventions live in `frontend/CLAUDE.md` and `docs/BRAND.md`.
- `backend/` — FastAPI server. Backend-specific conventions live in `backend/CLAUDE.md`.
- `docs/` — specs, sprint plans, brand. Sprint specs under `docs/specs_*/`.

## Commands

### Backend (`cd backend`, venv activated — Python 3.12, pinned in `backend/.python-version`)
- Run dev server: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` — `--host 0.0.0.0` lets a physical device on the same Wi-Fi reach it (bare `--reload` binds localhost only, unreachable from a phone). Pointing the app at a local backend: see `docs/STAGING.md`.
- Run all tests: `pytest`
- Run one test file: `pytest app/features/ai/tests/test_x.py`
- Run one test: `pytest path::test_name` (pytest-asyncio is configured; `pythonpath=.`)

### Frontend (`cd frontend`)
- Build + launch on a **physical device** (USB-connected): `npx expo run:android` or `npx expo run:ios`
  — compiles the native dev client, installs it, and starts Metro. Use this on first run and after any native change (new native dep, `app.json` native config, pods).
- Daily JS loop (dev client already installed): `npx expo start`
- Lint: `npm run lint` (eslint + prettier)
- No frontend test runner is configured. Verify on a physical device (emulator is not the team's test path).

> Package manager is currently **npm** (`package-lock.json`). A pnpm migration is in flight — check whether `pnpm-lock.yaml` exists before choosing.

## Architecture — the non-obvious parts

### Database schema has NO migration tool
Schema is created imperatively at startup in `ensure_core_tables()` (and `ensure_siat_tables()`) inside `backend/app/main.py`'s `lifespan`. To add a table or column: add a `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement there. **Do not reach for Alembic** — it isn't used. Prod DB is Postgres on Neon; async stack (SQLAlchemy async + asyncpg).

### Backend feature pattern
Each feature is a folder under `backend/app/features/<name>/` with `router.py` + `service.py` + `schemas.py`. Wire it by importing its router in `main.py` and calling `app.include_router(...)`. Shared infra is in `app/core/` (`auth`, `config`, `database`, `firebase`) and `app/middleware/` (`api_key_auth` for internal-only endpoints).

### Auth is Firebase, everywhere
All live features verify Firebase tokens via `app.core.firebase`. Use the same dependency the other routers use (e.g. `map_events/router.py`). **`backend/app/features/future_integration/` (SOS, chat_rooms) is legacy/unwired** — it still uses `password_hash` and is NOT mounted. It must be rewired to Firebase before use; see its `README.md`.

### AI feature is heavy and optional
`ai/router.py` is imported under try/except in `main.py` because `sentence-transformers` pulls ~1GB of torch. `backend/conftest.py` stubs `sentence_transformers` and `firebase_admin` so tests import `app.main` without downloading torch. Don't remove those stubs.

### SIAT runs on a background loop
`main.py` spawns a 30-min background task (`_siat_background_loop`) that evaluates cyclones and sends pushes. It starts in `lifespan`, not per-request.

### One worker — a blocking call freezes everything
Single uvicorn worker (`Procfile`), so any sync call inside an `async def` stalls all in-flight requests. Wrap blocking/CPU work in `asyncio.to_thread(...)`. **Don't add `--workers`:** `_siat_background_loop` starts per worker → duplicate pushes.

### Frontend routing is file-based (expo-router)
Routes live in `frontend/app/`. Route groups: `(auth)`, `(tabs)`. **Underscore-prefixed dirs are NOT routes** — `_components`, `_hooks`, `_services`, `_utils`, `_types.ts` are colocated private code for a route. Maps use `react-native-maps`.

### Backend URL is per-build, never a runtime toggle
The client picks its backend via `EXPO_PUBLIC_API_URL`, **inlined at bundle time** (never a runtime switch). Two sources depending on artifact:
- **Standalone builds** (`preview` / `production`): baked from `frontend/eas.json` — changing target means a new build.
- **Dev client** (`expo start` / `run:android`): read from local `frontend/.env` via Metro — change target by editing `.env` and restarting Metro with `-c`.

Full env setup (staging vs local backend, LAN IP) is in `docs/STAGING.md`.

## Environments & CI

- **Backend** runs on Railway; **prod DB** is Postgres on Neon. A separate **staging** environment is live (`https://backend-blueye-staging.up.railway.app`) — env URLs, teammate setup, the deploy flow, and the prod-DB SACRED RULE are documented in `docs/STAGING.md`.
- **Client → backend** target is build-time per EAS profile (see the build-time note above). It is not a runtime switch.
- **CI:** GitHub Actions runs **backend `pytest` on every PR** (`.github/workflows/backend-tests.yml`, with a Postgres service). **There is no frontend CI** — frontend changes are not gated by automated tests; verify on a physical device. Dependabot is enabled (`.github/dependabot.yml`).

## Conventions

- **Branching:** feature branches off `dev`, merged via PR. `main` and `dev` are protected — no direct pushes.
- **Merging — the method depends on how long the source branch lives:**
  - **Squash** a feature/hotfix branch. It gets deleted after the merge, so collapsing it loses nothing.
  - **Merge commit** for `dev → main`. Never squash this one. A squash creates a commit whose only parent is `main`'s previous tip, so `dev`'s commits never become ancestors of `main` and git keeps believing `main` has never seen them. The *next* release then replays every already-merged change as a conflict, and a conflict resolved carelessly is how a fix gets silently dropped. `main` history still reads cleanly — `git log --first-parent main` shows one entry per release.
- **PRs:** ≤ 400 lines. Larger features split into multiple PRs. Happy-path integration test + demoable on a physical device before merge.
- **Backend secrets** (DATABASE_URL, Firebase private key, LLM + notif keys) live in `backend/.env` (gitignored; see `backend/.env.example` for the list). Never commit them.
- **Frontend has no secrets.** `EXPO_PUBLIC_*` vars are public client config (embedded in the app bundle), set per build profile in `frontend/eas.json` (committed). Anything the client can read is public by definition — never put a real secret behind `EXPO_PUBLIC_`.


## Tooling for Claude Code

- **Context7 MCP is available** (configured in `.mcp.json`, committed — everyone on the team has it). Use it to fetch *current* docs for any
library/framework/SDK in this stack (Expo, FastAPI, SQLAlchemy, Firebase, react-native-*) before answering from memory — training data lags real releases. 
Prefer it over web search for library docs.