"""
Canonical SIAT-CT level -> color/danger-label mapping.

Single source of truth for the backend: `evaluator.py`, `service.py`, and
`alerts/router.py` each used to keep their own copy of this table (three
different sets of wording, one of them contradicting the others). Import
from here instead of redefining it.

Wording follows the official SIAT-CT scale (SEGOB / Protección Civil), which
communicates color + danger level ("Azul / peligro mínimo", "Amarillo /
peligro moderado", ...) — there is no official "phase" vocabulary
("Preparación", "Alarma", etc.); that was invented in earlier app code and is
why push notifications (color only) and the app (an invented phase word)
never said the same thing for the same event.

Frontend mirror: `frontend/utils/siatLevels.ts` — the two can't literally
share code (Python vs. TypeScript), so keep them in sync by hand when this
table changes.
"""

SIAT_LEVELS: dict[int, dict[str, str]] = {
    1: {"color": "AZUL", "danger": "Peligro mínimo"},
    2: {"color": "VERDE", "danger": "Peligro bajo"},
    3: {"color": "AMARILLO", "danger": "Peligro moderado"},
    4: {"color": "NARANJA", "danger": "Peligro alto"},
    5: {"color": "ROJO", "danger": "Peligro máximo"},
}


def siat_color(level: int) -> str:
    return SIAT_LEVELS.get(level, SIAT_LEVELS[1])["color"]


def siat_danger(level: int) -> str:
    return SIAT_LEVELS.get(level, SIAT_LEVELS[1])["danger"]


def siat_title(level: int) -> str:
    """'SIAT-CT Amarillo — Peligro moderado' — color and danger label together, always."""
    entry = SIAT_LEVELS.get(level, SIAT_LEVELS[1])
    return f"SIAT-CT {entry['color'].capitalize()} — {entry['danger']}"
