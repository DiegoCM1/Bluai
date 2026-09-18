"""Tests for the agent's tools and request-scoped handler binding.

Concerns, tested separately:
  - get_datetime: real-clock formatting + the never-raise fallback contract.
  - build_tool_handlers: the binding/override/fallback LOGIC, with the clock
    mocked out so the assertions are deterministic (not dependent on wall time).
  - get_nearby_cyclones: SIAT's assess_location mocked; only this tool's own
    job is tested (failure wording, coordinate binding, formatting). SIAT's
    contract has its own tests in siat/tests/test_assess_location.py.
"""

from datetime import datetime, timezone

import httpx
import pytest

from app.features.ai.tools import (
    DEFAULT_TZ,
    TOOL_SCHEMAS,
    _DIAS,
    build_tool_handlers,
    get_datetime,
    web_search,
)
from app.features.siat.levels import siat_title


# --- get_datetime: real behavior -------------------------------------------

@pytest.mark.asyncio
async def test_get_datetime_returns_spanish_string():
    s = await get_datetime("America/Mexico_City")
    assert s.startswith("Son las")
    assert any(dia in s for dia in _DIAS)  # contains a Spanish weekday


@pytest.mark.asyncio
async def test_get_datetime_bad_timezone_does_not_raise():
    # A tool must never raise into the agent loop — bad input degrades, not crashes.
    s = await get_datetime("Not/AReal_Zone")
    assert isinstance(s, str)
    assert s.startswith("Son las")


@pytest.mark.asyncio
async def test_get_datetime_distinct_zones_differ():
    mx = await get_datetime("America/Mexico_City")
    tokyo = await get_datetime("Asia/Tokyo")
    # Mexico City and Tokyo are many hours apart — the rendered strings must differ.
    assert mx != tokyo


# --- build_tool_handlers: binding logic (clock mocked) ----------------------

@pytest.fixture
def captured_tz(monkeypatch):
    """Replace get_datetime with a spy that records the timezone it received.

    build_tool_handlers' inner handler resolves `get_datetime` from the module
    namespace at call time, so patching the module attribute is seen.
    """
    seen = {}

    async def spy(timezone="__unset__"):
        seen["tz"] = timezone
        return "stubbed"

    monkeypatch.setattr("app.features.ai.tools.get_datetime", spy)
    return seen


@pytest.mark.asyncio
async def test_omitted_timezone_uses_user_zone(captured_tz):
    handlers = build_tool_handlers(user_timezone="America/Cancun")
    await handlers["get_datetime"]()  # model omits timezone
    assert captured_tz["tz"] == "America/Cancun"


@pytest.mark.asyncio
async def test_explicit_timezone_overrides_user_zone(captured_tz):
    handlers = build_tool_handlers(user_timezone="America/Cancun")
    await handlers["get_datetime"](timezone="Asia/Tokyo")  # user asked about another city
    assert captured_tz["tz"] == "Asia/Tokyo"


@pytest.mark.asyncio
async def test_no_user_zone_falls_back_to_default(captured_tz):
    handlers = build_tool_handlers(user_timezone=None)  # no location resolved
    await handlers["get_datetime"]()
    assert captured_tz["tz"] == DEFAULT_TZ


# --- web_search: Tavily contained, HTTP mocked ------------------------------

class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeClient:
    """Stand-in for httpx.AsyncClient that returns canned data (or raises)."""

    def __init__(self, *, data=None, exc=None):
        self._data = data
        self._exc = exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        if self._exc:
            raise self._exc
        return _FakeResponse(self._data)


@pytest.mark.asyncio
async def test_web_search_missing_key_degrades(monkeypatch):
    monkeypatch.setattr("app.features.ai.tools.settings.TAVILY_API_KEY", "")
    out = await web_search("huracán en Veracruz")
    assert isinstance(out, str)
    assert "no está disponible" in out.lower()


@pytest.mark.asyncio
async def test_web_search_formats_answer_and_sources(monkeypatch):
    monkeypatch.setattr("app.features.ai.tools.settings.TAVILY_API_KEY", "tvly-test")
    fake = {
        "answer": "Hay un aviso de huracán categoría 2.",
        "results": [
            {"title": "CONAGUA", "content": "El huracán se acerca a la costa.", "url": "https://conagua.gob.mx"},
        ],
    }
    monkeypatch.setattr(
        "app.features.ai.tools.httpx.AsyncClient",
        lambda *a, **k: _FakeClient(data=fake),
    )
    out = await web_search("estado del huracán")
    assert "Hay un aviso de huracán categoría 2." in out
    assert "CONAGUA" in out
    assert "conagua.gob.mx" in out


@pytest.mark.asyncio
async def test_web_search_http_error_degrades(monkeypatch):
    monkeypatch.setattr("app.features.ai.tools.settings.TAVILY_API_KEY", "tvly-test")
    monkeypatch.setattr(
        "app.features.ai.tools.httpx.AsyncClient",
        lambda *a, **k: _FakeClient(exc=httpx.ConnectError("boom")),
    )
    out = await web_search("cualquier cosa")
    assert isinstance(out, str)
    assert "no pude" in out.lower()


@pytest.mark.asyncio
async def test_web_search_empty_results(monkeypatch):
    monkeypatch.setattr("app.features.ai.tools.settings.TAVILY_API_KEY", "tvly-test")
    monkeypatch.setattr(
        "app.features.ai.tools.httpx.AsyncClient",
        lambda *a, **k: _FakeClient(data={"answer": "", "results": []}),
    )
    out = await web_search("consulta sin resultados")
    assert "No encontré resultados" in out


@pytest.mark.asyncio
async def test_web_search_budget_caps_real_calls(monkeypatch):
    """Past the per-turn budget, the tool short-circuits without hitting Tavily."""
    calls = {"n": 0}

    async def fake_web_search(query):
        calls["n"] += 1
        return f"result for {query}"

    monkeypatch.setattr("app.features.ai.tools.web_search", fake_web_search)
    handlers = build_tool_handlers(web_search_budget=2)

    await handlers["web_search"]("q1")
    await handlers["web_search"]("q2")
    capped = await handlers["web_search"]("q3")  # over budget

    assert calls["n"] == 2, "third search must not reach the real (paid) tool"
    assert "no busques más" in capped.lower()


@pytest.mark.asyncio
async def test_web_search_budget_is_per_request(monkeypatch):
    """Each build_tool_handlers() call gets a fresh budget (no shared state)."""
    async def fake_web_search(query):
        return "ok"

    monkeypatch.setattr("app.features.ai.tools.web_search", fake_web_search)

    h1 = build_tool_handlers(web_search_budget=1)
    first = await h1["web_search"]("a")
    second = await h1["web_search"]("b")  # h1 exhausted
    assert "no busques más" in second.lower()

    h2 = build_tool_handlers(web_search_budget=1)  # fresh request
    assert await h2["web_search"]("c") == "ok"


# --- get_nearby_cyclones: SIAT seam + DB session mocked ---------------------

class _FakeSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *args):
        return False


@pytest.fixture
def no_db(monkeypatch):
    monkeypatch.setattr("app.features.ai.tools.AsyncSessionLocal", _FakeSession)


def _assessment(name, level, distance_km, out_of_range=False):
    return {
        "name": name, "category_label": "Huracán", "advisory_time": datetime.now(timezone.utc),
        "siat_level": level, "distance_km": distance_km, "eta_hours": 9.0, "out_of_range": out_of_range,
    }


@pytest.mark.asyncio
async def test_nearby_cyclones_lookup_failure_never_reads_as_no_threat(monkeypatch, no_db):
    """Telling someone "no hurricanes" because the DB failed is the worst possible bug."""
    async def broken(db, lat, lon):
        raise RuntimeError("db down")

    monkeypatch.setattr("app.features.ai.tools.assess_location", broken)
    out = await build_tool_handlers(latitude=21.16, longitude=-86.85)["get_nearby_cyclones"]()

    # Must LEAD with the failure. A plain `"no hay" not in out` check is wrong:
    # the text itself tells the model "No afirmes que no hay ciclones".
    assert out.lower().startswith("no fue posible")


@pytest.mark.asyncio
async def test_nearby_cyclones_uses_request_coords_not_model_args(monkeypatch, no_db):
    seen = {}

    async def spy(db, lat, lon):
        seen["coords"] = (lat, lon)
        return []

    monkeypatch.setattr("app.features.ai.tools.assess_location", spy)
    handlers = build_tool_handlers(latitude=21.16, longitude=-86.85)
    await handlers["get_nearby_cyclones"](location="Tulum")  # model invents an arg

    assert seen["coords"] == (21.16, -86.85)


@pytest.mark.asyncio
async def test_nearby_cyclones_lists_threats_with_siat_wording_and_distant(monkeypatch, no_db):
    async def fake(db, lat, lon):
        return [_assessment("ERICK", 4, 180.0), _assessment("NORBERT", 1, 4441.0, out_of_range=True)]

    monkeypatch.setattr("app.features.ai.tools.assess_location", fake)
    out = await build_tool_handlers(latitude=21.16, longitude=-86.85)["get_nearby_cyclones"]()

    assert "ERICK" in out
    assert siat_title(4) in out  # same wording as the SIAT push, whatever levels.py says
    assert "NORBERT" in out      # distant storms are still mentioned, not dropped


# --- registry / schema consistency -----------------------------------------

def test_every_schema_has_a_handler():
    handlers = build_tool_handlers()
    schema_names = {s["function"]["name"] for s in TOOL_SCHEMAS}
    assert schema_names <= set(handlers), "every advertised tool needs a handler"
