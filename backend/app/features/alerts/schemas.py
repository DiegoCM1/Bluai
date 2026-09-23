from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID

class AlertSummary(BaseModel):
    id:UUID
    timestamp:datetime
    level:int
    score:int
    title:str
    short:str
    # Plain-language rewrite (SMN bulletins only, see ai.service.generate_plain_summary).
    # None for every other alert source — clients fall back to `short`.
    ai_summary: str | None = None


class AlertDetail(BaseModel):
    id: UUID
    timestamp: datetime
    level: int
    score: int
    title: str
    short: str
    lat: float | None = None
    lon: float | None = None
    factors: list
    recommendations: list
    pdf_url: str | None = None
    ai_summary: str | None = None


class AlertCreate(BaseModel):
    level: int = Field(ge=1, le=5)
    score: int = Field(ge=0, le=100)
    title: str = Field(min_length=1, max_length=255)
    short: str = Field(min_length=1, max_length=500)
    lat: float
    lon: float
    factors: list = []
    recommendations: list = []


class AlertWithSIAT(BaseModel):
    id: UUID
    timestamp: datetime
    level: int
    score: int
    title: str
    short: str
    siat_level: int | None = None
    siat_color: str | None = None


class OpenWeatherAlert(BaseModel):
    sender_name: str
    event: str
    start: int
    end: int
    description: str
    tags: list[str]


class OpenWeatherLocation(BaseModel):
    lat: float
    lon: float
    timezone: str
    timezone_offset: int


class OpenWeatherCurrent(BaseModel):
    temperature: float
    humidity: int
    pressure: int
    wind_speed: float
    wind_deg: int
    weather: str
    description: str


class OneCallAlertsResponse(BaseModel):
    location: OpenWeatherLocation
    current: OpenWeatherCurrent
    risk_level: int
    alerts: list[OpenWeatherAlert]
    alerts_count: int
    has_alerts: bool


class MexicoWeatherPoint(BaseModel):
    name: str
    location: OpenWeatherLocation
    current: OpenWeatherCurrent
    risk_level: int
    alerts: list[OpenWeatherAlert]
    alerts_count: int
    has_alerts: bool


class MexicoWeatherOverviewResponse(BaseModel):
    country: str
    generated_at: datetime
    points_count: int
    points_with_alerts: int
    points: list[MexicoWeatherPoint]


class ActiveAlertItem(BaseModel):
    source: str          # "SIAT-CT" | "SYSTEM" | "SMN"
    type: str            # "cyclonic" | "system" | "bulletin"
    level: int           # 1–5 (SIAT scale)
    color: str | None    # "AZUL"|"VERDE"|"AMARILLO"|"NARANJA"|"ROJO"|None
    title: str
    short: str


class SiatUserState(BaseModel):
    level: int
    color: str
    reason: str
    updated_at: datetime


class SMNBulletin(BaseModel):
    aviso_num: int | None
    issued_at: str | None
    headline: str
    summary: str | None
    pdf_url: str | None = None
    source: str


class SMNCycloneAdvisory(BaseModel):
    ocean: str | None          # "atlantico" | "pacifico"
    system_name: str | None
    aviso_num: int | None
    level: int
    synthesis: str | None
    location_text: str | None  # e.g. "820 km al sur-suroeste de Zihuatanejo, Gro."
    lat: float | None
    lon: float | None
    movement_text: str | None
    wind_sustained_kmh: float | None
    wind_gusts_kmh: float | None
    pressure_hpa: float | None
    recommendations: str | None
    pdf_url: str | None
    issued_at: datetime


class ActiveAlertsResponse(BaseModel):
    generated_at: datetime
    user_siat: SiatUserState | None
    cyclonic_alerts: list[ActiveAlertItem]
    general_alerts: list[ActiveAlertItem]
    smn_bulletin: SMNBulletin | None
    smn_cyclone_advisories: list[SMNCycloneAdvisory]
