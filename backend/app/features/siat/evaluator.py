"""
SIAT-CT evaluator.

Maps cyclone proximity + intensity to the five official SIAT-CT levels
(color + danger label defined in `levels.py`, the canonical source):
  1 - AZUL      (peligro mínimo,  > 72 h)
  2 - VERDE     (peligro bajo,    24–72 h)
  3 - AMARILLO  (peligro moderado,12–24 h)
  4 - NARANJA   (peligro alto,    6–12 h)
  5 - ROJO      (peligro máximo,  < 6 h)

Primary strategy: ETA-based (distance / movement speed), adjusted by heading:
a cyclone heading toward the user keeps the full ETA-based level; one moving
laterally is stepped down by one level; one moving away is stepped down by
two levels. The adjusted level is always floored at what plain distance +
wind intensity alone would justify (see `_level_from_distance`), so a nearby
"departing" cyclone is never trivialized to AZUL.
Stationary cyclone fallback: distance + wind intensity with conservative thresholds.
Out-of-range: cyclones beyond MAX_THREAT_DISTANCE_KM are flagged — the service
layer skips DB writes and notifications for these to reduce noise.

Known limitation: heading is a straight-line bearing parsed from the cyclone's
reported movement direction, not the official NHC forecast cone — a cyclone
that curves back toward the user after "moving away" isn't accounted for.
Incorporating NHC forecast cone data would eliminate this in a future version.
"""

import math

from app.features.siat.direction import angular_difference, bearing_deg, parse_movement_direction
from app.features.siat.levels import siat_color

MAX_THREAT_DISTANCE_KM = 1500
# Beyond this range, even a fast-moving cyclone (20 km/h) takes > 75 h to arrive —
# safely above the AZUL threshold. Assessments beyond this distance are
# operationally irrelevant and would flood the DB with noise.


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _level_from_eta(eta_hours: float) -> int:
    if eta_hours < 6:
        return 5
    if eta_hours < 12:
        return 4
    if eta_hours < 24:
        return 3
    if eta_hours < 72:
        return 2
    return 1


def _level_from_distance(distance_km: float, wind_kmh: float) -> int:
    """
    Fallback for stationary cyclones (movementSpeed = 0): ETA is undefined so
    level is derived from proximity and intensity. Thresholds are deliberately
    tighter than the ETA-based path to account for the sustained danger a stalled
    system poses even without an imminent landfall trajectory.
    """
    if distance_km < 150 and wind_kmh >= 150:
        return 5
    if distance_km < 300 and wind_kmh >= 100:
        return 4
    if distance_km < 500 and wind_kmh >= 75:
        return 3
    if distance_km < 700:
        return 2
    return 1


def evaluate_user(user_lat: float, user_lon: float, cyclone: dict) -> dict:
    """
    Returns a dict with: siat_level, siat_color, distance_km, eta_hours,
    reason, and out_of_range (bool).

    When out_of_range is True the caller should skip persisting the assessment
    and sending notifications — the cyclone is too distant to be actionable.
    """
    distance_km = haversine_km(user_lat, user_lon, cyclone["lat"], cyclone["lon"])

    if distance_km > MAX_THREAT_DISTANCE_KM:
        return {
            "siat_level": 1,
            "siat_color": siat_color(1),
            "distance_km": round(distance_km, 2),
            "eta_hours": None,
            "reason": (
                f"Ciclón: {cyclone.get('name', '?')} fuera de zona de amenaza "
                f"({distance_km:.0f} km > {MAX_THREAT_DISTANCE_KM} km límite)"
            ),
            "out_of_range": True,
        }

    speed = cyclone.get("movement_speed_kmh") or 0.0

    if speed > 0:
        eta_hours: float | None = distance_km / speed
        level = _level_from_eta(eta_hours)

        floor_level = _level_from_distance(distance_km, cyclone.get("wind_kmh", 0.0))
        heading_deg = parse_movement_direction(cyclone.get("movement_direction"))
        if heading_deg is not None:
            bearing_to_user = bearing_deg(cyclone["lat"], cyclone["lon"], user_lat, user_lon)
            angular_diff = angular_difference(heading_deg, bearing_to_user)
            if angular_diff > 120:
                level -= 2
            elif angular_diff > 60:
                level -= 1
        level = max(level, floor_level, 1)

        eta_label = f"ETA estimada: {eta_hours:.1f}h"
    else:
        eta_hours = None
        level = _level_from_distance(distance_km, cyclone.get("wind_kmh", 0.0))
        eta_label = "ETA: no disponible (ciclón estacionario)"

    reason = " | ".join([
        f"Ciclón: {cyclone.get('name', '?')} ({cyclone.get('status', '?')})",
        f"Distancia: {distance_km:.0f} km",
        f"Vientos: {cyclone.get('wind_kmh', 0):.0f} km/h",
        eta_label,
    ])

    return {
        "siat_level": level,
        "siat_color": siat_color(level),
        "distance_km": round(distance_km, 2),
        "eta_hours": round(eta_hours, 2) if eta_hours is not None else None,
        "reason": reason,
        "out_of_range": False,
    }
