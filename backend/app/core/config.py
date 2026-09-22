from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    #Database
    DATABASE_URL:str

    #Firebase
    FIREBASE_PROJECT_ID: str
    FIREBASE_CLIENT_EMAIL: str
    FIREBASE_PRIVATE_KEY: str

    #Notifications
    NOTIF_API_KEY:str

    #OpenWeather
    OPENWEATHER_API_KEY:str

    # AI (optional - only needed for ai/chat feature)
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = ""
    LLM_MODEL: str = ""

    # Web search tool (optional - only needed for the AI web_search tool)
    TAVILY_API_KEY: str = ""
    # "basic" = 1 credit/search, "advanced" = 2 credits/search. Flip via env,
    # no code change. Default basic to stretch the free-tier monthly quota.
    TAVILY_SEARCH_DEPTH: str = "basic"

    # Payments — Stripe (optional; omit to disable checkout)
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_SAFE_MONTHLY: str = ""
    STRIPE_PRICE_SAFE_ANNUAL: str = ""
    STRIPE_PRICE_GUARD_MONTHLY: str = ""
    STRIPE_PRICE_GUARD_ANNUAL: str = ""
    # Optional public origin used in checkout return URLs. Leave empty to use
    # the origin of the request, which keeps staging and production separate.
    PAYMENTS_PUBLIC_URL: str = ""
    WEB_PAYMENTS_ENABLED: bool = False
    WEB_PAYMENTS_ORIGIN: str = "https://www.bluai.com.mx"

    # Payments — MercadoPago (optional; omit to disable)
    MP_ACCESS_TOKEN: str = ""

    # Dev-only bypasses
    DEV_BYPASS_MAP_EVENTS_AUTH: bool = False

    # Dev-tools allowlist — gates the internal test-notification and SIAT
    # inject endpoints (see notifications/router.py:require_dev_tools_admin).
    # A user matches by EITHER list; both comma-separated. Empty strings
    # disable the endpoints for everyone (production default) — there used to
    # be a DEV_BYPASS_NOTIF_TEST_AUTH flag that skipped this allowlist
    # entirely in staging; it was removed because it defeated the point of
    # having a list at all.
    NOTIFICATION_TEST_ADMIN_EMAILS: str = ""
    # Matched against `users.phone` (an onboarding profile field), not a
    # Firebase token claim — sign-in here is Google/Apple only, so a token
    # never carries a phone_number. Any non-digit formatting (spaces, +52,
    # dashes) is stripped before comparing on both sides.
    NOTIFICATION_TEST_ADMIN_PHONES: str = ""

    model_config = SettingsConfigDict(env_file=(".env", ".env.local"))

settings = Settings()
