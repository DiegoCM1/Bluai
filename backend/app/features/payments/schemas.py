from pydantic import BaseModel
from typing import Literal, Optional


class PlanResponse(BaseModel):
    slug: str
    name: str
    description: str
    monthly_price: Optional[float]
    annual_price: Optional[float]
    annual_discount: int
    features: list[str]
    is_free: bool


class SubscriptionResponse(BaseModel):
    plan_slug: str
    status: str
    current_period_end: Optional[str]
    billing_period: Literal["monthly", "annual"]
    payment_provider: Optional[Literal["stripe", "mercadopago"]]
    cancel_at_period_end: bool


class CheckoutRequest(BaseModel):
    plan_slug: Literal["safe", "guard"]
    billing_period: Literal["monthly", "annual"]
    provider: Literal["stripe", "mercadopago", "auto"] = "auto"


class CheckoutResponse(BaseModel):
    checkout_url: str


class SimulateRequest(BaseModel):
    plan_slug: Literal["free", "safe", "guard", "edu"]
    billing_period: Literal["monthly", "annual"] = "monthly"


class FamilyMemberResponse(BaseModel):
    id: str
    name: str
    initials: str
    distance: float
    distance_unit: str
    last_updated: Optional[str]
    avatar_color: str
    email: Optional[str] = None


class AddFamilyMemberRequest(BaseModel):
    email: str
