"""Tools the AI agent can call during a chat turn.

Step 1 keeps this deliberately simple: plain functions plus a tiny registry the
agent loop can iterate over. When a second real tool lands (web search), promote
this to a `tools/` package with a proper `Tool` abstraction — not before.

A "tool" here is three things bound together:
  - a name (how the model refers to it)
  - a JSON schema (what the model reads to decide when/how to call it)
  - a handler (the async Python function that actually runs)
"""

import logging
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.features.siat.levels import siat_title
from app.features.siat.service import assess_location

logger = logging.getLogger(__name__)

DEFAULT_TZ = "America/Mexico_City"

# Spanish names so the model gets text it can echo directly to the user.
_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


async def get_datetime(timezone: str = DEFAULT_TZ) -> str:
    """Return the current date and time as a human-readable Spanish string.

    Falls back to the default timezone, then to UTC, instead of raising — a tool
    must never crash the agent loop. The model can recover from a degraded answer;
    it cannot recover from an exception.
    """
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        logger.warning("[tool:get_datetime] unknown timezone %r, falling back to %s", timezone, DEFAULT_TZ)
        try:
            tz = ZoneInfo(DEFAULT_TZ)
        except ZoneInfoNotFoundError:
            logger.error("[tool:get_datetime] tzdata missing, falling back to UTC")
            tz = ZoneInfo("UTC") if _utc_available() else None

    now = datetime.now(tz) if tz else datetime.utcnow()
    dia = _DIAS[now.weekday()]
    mes = _MESES[now.month - 1]
    readable = f"Son las {now.strftime('%H:%M')} del {dia} {now.day} de {mes} de {now.year}"
    return readable


def _utc_available() -> bool:
    try:
        ZoneInfo("UTC")
        return True
    except ZoneInfoNotFoundError:
        return False


# === web_search ============================================================
# Provider (Tavily) is fully contained here. Search APIs are NOT standardized,
# so switching providers means rewriting this function's body — but ONLY this
# body. The model's contract (web_search(query) -> str) and the returned string
# never expose Tavily's shape, so nothing downstream changes on a swap.

_TAVILY_URL = "https://api.tavily.com/search"


def _format_tavily(data: dict, query: str) -> str:
    """Collapse Tavily's JSON into a compact, model-friendly string.

    We lead with Tavily's synthesized `answer` (cheap context for a 120-word
    assistant) and append a few source snippets the model can cite.
    """
    lines: list[str] = []
    answer = (data.get("answer") or "").strip()
    if answer:
        lines.append(answer)

    for r in (data.get("results") or [])[:3]:
        title = (r.get("title") or "").strip()
        # Tavily uses `content`/`url`; tolerate `snippet`/`link` defensively.
        content = (r.get("content") or r.get("snippet") or "").strip()
        url = r.get("url") or r.get("link") or ""
        if content:
            lines.append(f"- {title}: {content[:200]} ({url})")

    if not lines:
        return f"No encontré resultados para: {query}."
    return "\n".join(lines)


async def web_search(query: str) -> str:
    """Search the web via Tavily; return a compact summary for the model.

    Degrades to a text message on any failure (missing key, network, HTTP) —
    a tool must never raise into the agent loop.
    """
    if not settings.TAVILY_API_KEY:
        logger.warning("[tool:web_search] TAVILY_API_KEY not set — tool disabled")
        return "La búsqueda web no está disponible en este momento."

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                _TAVILY_URL,
                headers={"Authorization": f"Bearer {settings.TAVILY_API_KEY}"},
                json={
                    "query": query,
                    "search_depth": settings.TAVILY_SEARCH_DEPTH,
                    "max_results": 5,
                    "include_answer": "basic",
                },
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        logger.error("[tool:web_search] Tavily request failed: %s", exc, exc_info=True)
        return "No pude completar la búsqueda web en este momento."

    return _format_tavily(data, query)


# === get_nearby_cyclones ===================================================
# Zero SIAT logic lives here. All scoring comes from siat.assess_location()
# and the level wording from siat.levels, so a SIAT change reaches the chat
# with no edits to this file. This section only turns the result into text.

_MAX_THREATS_LISTED = 3


def _advisory_age(advisory_time: datetime | None) -> str:
    """'aviso de hace 2 h': relative, so it needs no timezone to read right."""
    if advisory_time is None:
        return ""
    if advisory_time.tzinfo is None:
        advisory_time = advisory_time.replace(tzinfo=dt_timezone.utc)
    minutes = max(0, int((datetime.now(dt_timezone.utc) - advisory_time).total_seconds() // 60))
    age = f"{minutes} min" if minutes < 60 else f"{minutes // 60} h"
    return f" (aviso de hace {age})"


def _format_cyclones(assessments: list[dict]) -> str:
    """Compact Spanish summary of assess_location() output for the model."""
    threats = [a for a in assessments if not a["out_of_range"]]
    distant = [a for a in assessments if a["out_of_range"]]

    lines: list[str] = []
    if threats:
        lines.append("Ciclones que pueden afectar la ubicación del usuario:")
        for a in threats[:_MAX_THREATS_LISTED]:
            eta = a["eta_hours"]
            if eta is None:
                arrival = "estacionario, sin hora estimada de llegada"
            elif eta < 1:
                arrival = "llegada estimada en menos de 1 h"
            else:
                arrival = f"llegada estimada en {eta:.0f} h"
            lines.append(
                f"- {a['name']} ({a['category_label']}): {siat_title(a['siat_level'])}. "
                f"A {a['distance_km']:.0f} km, {arrival}{_advisory_age(a['advisory_time'])}."
            )
        # Least severe ones are the ones cut (input is worst-first), but say so,
        # never drop a threat silently.
        if len(threats) > _MAX_THREATS_LISTED:
            lines.append(f"(+{len(threats) - _MAX_THREATS_LISTED} ciclón(es) más de menor nivel)")
    else:
        lines.append("Ningún ciclón activo representa amenaza para la ubicación del usuario.")

    if distant:
        names = ", ".join(f"{a['name']} ({a['distance_km']:.0f} km)" for a in distant)
        lines.append(f"Ciclones activos lejanos, sin amenaza: {names}.")

    lines.append("Fuente: SIAT-CT de Bluai con datos del NHC.")
    return "\n".join(lines)


async def get_nearby_cyclones(latitude: float | None = None, longitude: float | None = None) -> str:
    """Active cyclones assessed against the user's location, as model-ready text.

    Four outcomes, each worded differently on purpose. "Lookup failed" must
    never read like "no cyclones": telling someone there's no hurricane
    because the DB hiccuped is the worst failure this tool can have.
    """
    if latitude is None or longitude is None:
        return (
            "No tengo la ubicación del usuario, así que no puedo evaluar ciclones "
            "cercanos. Pídele que active la ubicación en la app."
        )

    try:
        async with AsyncSessionLocal() as db:
            assessments = await assess_location(db, latitude, longitude)
    except Exception as exc:
        logger.error("[tool:get_nearby_cyclones] lookup failed: %s", exc, exc_info=True)
        return (
            "No fue posible consultar los ciclones activos en este momento. "
            "No afirmes que no hay ciclones; remite al usuario al SMN / CONAGUA."
        )

    if not assessments:
        return "No hay ciclones activos registrados en este momento. Fuente: SIAT-CT de Bluai con datos del NHC."
    return _format_cyclones(assessments)


GET_DATETIME_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_datetime",
        "description": (
            "Obtiene la fecha y hora actual. Úsalo cuando el usuario pregunte por la hora, la fecha, el día de hoy, o cuánto falta para un evento, no uses esto a menos que el datetime sea necesario para tu respuesta"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": (
                        "Zona horaria IANA. OPCIONAL: si se omite, se usa "
                        "automáticamente la zona horaria de la ubicación del usuario. "
                        "Especifícala solo si el usuario pregunta por OTRO lugar "
                        "(por ejemplo 'Asia/Tokyo')."
                    ),
                }
            },
            "required": [],
        },
    },
}


WEB_SEARCH_SCHEMA = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Busca información actualizada en internet. Úsalo cuando necesites datos recientes o que no conoces con certeza: noticias, avisos oficiales, estado de carreteras o refugios, o cualquier dato en tiempo real."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "La consulta de búsqueda, específica y concisa, preferiblemente en español.",
                }
            },
            "required": ["query"],
        },
    },
}


# No parameters on purpose: the location comes from the request (bound in
# build_tool_handlers), never from the model, so it can't guess coordinates.
GET_NEARBY_CYCLONES_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_nearby_cyclones",
        "description": (
            "Consulta los ciclones tropicales activos (huracanes, tormentas y depresiones tropicales) y evalúa su amenaza para la ubicación actual del usuario con la escala oficial SIAT-CT: nivel de peligro, distancia y hora estimada de llegada. Úsala ANTES que web_search ante cualquier pregunta sobre huracanes, tormentas o ciclones cerca del usuario, o sobre si está en peligro. Usa automáticamente la ubicación del usuario; no necesita parámetros."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}


# --- The registry the agent loop consumes ----------------------------------
# name -> handler. Static default map (used by tests / when there's no request
# context). The agent loop uses build_tool_handlers() to bind per-request state.
TOOL_HANDLERS = {
    "get_datetime": get_datetime,
    "web_search": web_search,
    "get_nearby_cyclones": get_nearby_cyclones,  # no request context -> "no location" answer
}

TOOL_SCHEMAS = [
    GET_DATETIME_SCHEMA,
    WEB_SEARCH_SCHEMA,
    GET_NEARBY_CYCLONES_SCHEMA,
]


WEB_SEARCH_BUDGET = 2  # max Tavily calls per assistant turn (credit protection)


def build_tool_handlers(
    *,
    user_timezone: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    web_search_budget: int = WEB_SEARCH_BUDGET,
) -> dict:
    """Build request-scoped tool handlers with the current user's context baked in.

    Module-level TOOL_HANDLERS is created once at import — long before any
    request — so it can't know the user's timezone. Per request we capture the
    live context in a closure: when the model omits `timezone`, the tool falls
    back to the USER's real zone (resolved server-side from their coordinates),
    not a hardcoded default. The model can still pass an explicit timezone to
    override (e.g. the user asks about another city).

    The same closure also carries a per-turn web_search counter. Models tend to
    re-search greedily (3+ Tavily calls for one question = 3+ credits), so we cap
    it in CODE — a prompt nudge can only ask, this guarantees. Past the budget,
    the tool short-circuits (no Tavily call, no credit) and tells the model to
    answer with what it already has.

    The user's coordinates are bound the same way. get_nearby_cyclones takes
    no parameters from the model, so it always evaluates the location the
    request came from, never one the model guessed.
    """
    user_tz = user_timezone or DEFAULT_TZ
    state = {"web_searches": 0}

    async def _get_datetime(timezone: str | None = None) -> str:
        return await get_datetime(timezone or user_tz)

    async def _web_search(query: str) -> str:
        if state["web_searches"] >= web_search_budget:
            logger.info("[tool:web_search] budget %s reached, refusing extra search", web_search_budget)
            return (
                "Ya realizaste varias búsquedas. Responde ahora con la información "
                "que ya tienes; no busques más."
            )
        state["web_searches"] += 1
        return await web_search(query)

    async def _get_nearby_cyclones(**ignored) -> str:
        # The schema has no parameters, but models sometimes invent one (e.g.
        # {"location": "Cancún"}). Ignore it instead of failing the tool with a
        # TypeError: the answer is always for the request's own coordinates.
        if ignored:
            print(f"[tool:get_nearby_cyclones] ignoring model-supplied args: {ignored!r}")
        return await get_nearby_cyclones(latitude, longitude)

    return {
        "get_datetime": _get_datetime,
        "web_search": _web_search,
        "get_nearby_cyclones": _get_nearby_cyclones,
    }