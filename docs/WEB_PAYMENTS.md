# Live website subscriptions

Companion website: DiegoCM1/bluai-landing, `/membresias`.
Deploy this backend to production before enabling the website checkout.

New public endpoint: GET `/api/v1/payments/web/plans`.
New Firebase-authenticated endpoint: POST `/api/v1/payments/web/checkout`, with
`plan_slug`, `billing_period`, and the displayed `price_id`. Amounts, user identity
and redirect URLs are resolved server-side. The existing signed Stripe webhook
is the source of membership activation. Existing mobile return URLs are retained.

Railway production configuration (never commit actual secrets):

- WEB_PAYMENTS_ENABLED=false by default; enable only after confirming live prices.
- WEB_PAYMENTS_ORIGIN=https://www.bluai.com.mx (fixed HTTPS origin).
- STRIPE_SECRET_KEY: live secret or restricted key with needed API permissions.
- STRIPE_WEBHOOK_SECRET: secret of this production endpoint.
- STRIPE_PRICE_SAFE_MONTHLY, STRIPE_PRICE_SAFE_ANNUAL,
  STRIPE_PRICE_GUARD_MONTHLY, STRIPE_PRICE_GUARD_ANNUAL: active live recurring
  fixed prices in USD or MXN, billed once per month/year respectively.

Register `/api/v1/payments/webhook/stripe` for checkout.session.completed,
customer.subscription.updated, customer.subscription.deleted and invoice.payment_failed.
Prices are read from Stripe, with no inline-price or Mercado Pago fallback.
Startup creates web_checkouts to persist checkout recovery/idempotency per user.
Open sessions are reused; different selections are blocked until expiry.
Existing paid memberships, including pending cancellation, block a second purchase.

No live payment has been made during development. Before announcing availability,
verify Firebase web sign-in, confirmed pricing, webhook delivery, membership on the
production app, and renewal cancellation. The distributed staging APK does not
share production memberships. A production APK is needed for that distribution.

Stripe API: https://docs.stripe.com/payments/checkout/build-subscriptions
