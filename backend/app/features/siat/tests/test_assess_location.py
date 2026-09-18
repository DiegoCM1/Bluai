"""assess_location() — the read-only contract the AI chat tool depends on.

Only the data source (get_active_cyclones) is mocked; evaluate_user runs for
real, so a SIAT scoring change is exercised here too. Assertions check the
SHAPE and ORDER of the contract, never specific level numbers — retuning SIAT
thresholds must not break these tests, only breaking the contract should.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.features.siat.service import assess_location

_SVC = "app.features.siat.service"

# User in Cancún.
_USER_LAT, _USER_LON = 21.16, -86.85

_GUARANTEED_KEYS = {
    "name", "category_label", "advisory_time",
    "siat_level", "distance_km", "eta_hours", "out_of_range",
}


def _row(name: str, lat: float, lon: float, wind_kmh: float | None = 150.0, speed_kmh: float = 15.0) -> dict:
    """A cyclone shaped like a get_active_cyclones() row."""
    return {
        "id": 1,
        "source": "FAKE",
        "name": name,
        "lat": lat,
        "lon": lon,
        "wind_kmh": wind_kmh,
        "movement_direction": None,
        "movement_direction_deg": None,
        "movement_speed_kmh": speed_kmh,
        "category_code": "HU",
        "category_label": "Huracán",
        "advisory_time": datetime.now(timezone.utc),
    }


@pytest.mark.asyncio
async def test_assess_location_contract_and_worst_first_order():
    far = _row("LEJOS", 30.0, -50.0)    # mid-Atlantic, well past the threat radius
    near = _row("CERCA", 20.0, -84.0)   # ~320 km from Cancún
    # Far listed first on purpose: the function must reorder, not echo input order.
    with patch(f"{_SVC}.get_active_cyclones", new_callable=AsyncMock, return_value=[far, near]):
        result = await assess_location(MagicMock(), _USER_LAT, _USER_LON)

    assert [a["name"] for a in result] == ["CERCA", "LEJOS"]
    for a in result:
        assert _GUARANTEED_KEYS <= a.keys()
    assert result[0]["out_of_range"] is False
    assert result[1]["out_of_range"] is True


@pytest.mark.asyncio
async def test_assess_location_tolerates_null_wind_from_db():
    """wind_kmh is a nullable column; evaluate_user compares it numerically."""
    stalled = _row("SIN-VIENTO", 20.0, -84.0, wind_kmh=None, speed_kmh=0.0)
    with patch(f"{_SVC}.get_active_cyclones", new_callable=AsyncMock, return_value=[stalled]):
        result = await assess_location(MagicMock(), _USER_LAT, _USER_LON)

    assert len(result) == 1
    assert 1 <= result[0]["siat_level"] <= 5
