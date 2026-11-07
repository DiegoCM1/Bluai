from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class FakeCycloneRequest(BaseModel):
    name: str = "FALSO-1"
    lat: float
    lon: float
    wind_kmh: float = Field(default=120.0, gt=0)
    movement_speed_kmh: float = Field(default=20.0, ge=0)
    movement_direction: str = "NW"


class UserSiatStatus(BaseModel):
    user_id: int
    current_level: int
    siat_color: str
    last_notified_level: int | None
    last_notified_at: datetime | None
    active_cyclone_id: int | None
    updated_at: datetime


class AssessmentResult(BaseModel):
    user_id: int
    siat_level: int
    siat_color: str
    distance_km: float | None
    eta_hours: float | None
    reason: str


class RunCycleResponse(BaseModel):
    cyclones_found: int
    users_evaluated: int
    notifications_sent: int
    assessments: list[AssessmentResult]


class InjectCycloneResponse(RunCycleResponse):
    cyclone_event_id: int
    cyclone_name: str


class InjectSMNAlertRequest(BaseModel):
    level: int = Field(default=3, ge=1, le=5)
    title: str = "SMN: Alerta Meteorológica de Prueba [TEST]"
    short: str = "Alerta de prueba generada por el equipo Bluai. No es una alerta real."


class InjectSMNAlertResponse(BaseModel):
    alert_id: str
    users_evaluated: int
    notifications_sent: int


class ResetStateResponse(BaseModel):
    message: str
    user_id: int


class AffectedUser(BaseModel):
    user_id: int
    distance_km: float


class AffectedUsersResponse(BaseModel):
    total: int
    users: list[AffectedUser]


class ActiveCycloneItem(BaseModel):
    id: int
    source: str
    name: str
    lat: float
    lon: float
    wind_kmh: float | None
    movement_direction: str | None
    movement_direction_deg: float | None
    movement_speed_kmh: float | None
    category_code: str
    category_label: str
    advisory_time: datetime | None


class ActiveCyclonesResponse(BaseModel):
    total: int
    cyclones: list[ActiveCycloneItem]
