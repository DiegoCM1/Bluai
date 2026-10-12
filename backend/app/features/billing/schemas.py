import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FiscalProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rfc: str = Field(min_length=12, max_length=13)
    legal_name: str = Field(min_length=1, max_length=255)
    postal_code: str = Field(pattern=r"^[0-9]{5}$")
    tax_regime: str = Field(pattern=r"^[0-9]{3}$")
    cfdi_use: str = Field(pattern=r"^[A-Z][0-9]{2}$")

    @field_validator("rfc", "legal_name", "cfdi_use", mode="before")
    @classmethod
    def normalize(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("rfc")
    @classmethod
    def check_rfc(cls, value: str) -> str:
        if not re.fullmatch(r"[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}", value):
            raise ValueError("El RFC no tiene un formato válido.")
        return value


class BillingCapabilities(BaseModel):
    fiscal_profile_available: bool = True
    invoice_issuance_available: bool = False
    status: str = "pending_provider_setup"
    demo_invoicing_available: bool = False
    mode: str = "test"


class InvoiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_id: str = Field(pattern=r"^in_[A-Za-z0-9]+$", max_length=100)


class TestInvoice(BaseModel):
    id: str
    payment_id: str | None = None
    status: str
    mode: str = "test"
