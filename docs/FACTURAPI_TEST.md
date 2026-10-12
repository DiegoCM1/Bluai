# Sandbox membership invoicing

The billing endpoints use only organization Facturapi Test credentials and
Stripe sandbox credentials. No Live invoice is emitted by this integration.

Configure `FACTURAPI_TEST_SECRET_KEY` privately in Railway staging. The existing
`STRIPE_TEST_SECRET_KEY` must identify the same sandbox used for membership
payments. Never expose either key to the browser or commit it.

The website account saves its own fiscal profile, selects a confirmed payment,
and requests a Test invoice. The backend verifies payment ownership and its
positive paid amount directly with Stripe. It preserves the fiscal snapshot and
provider idempotency key across retries. XML/PDF downloads require ownership.

The example tax treatment and USD exchange rate are sandbox demonstration
parameters, not approved fiscal production settings. Test documents have no
fiscal validity. Production invoicing requires a separate implementation.

Validation: combined backend suite passed 310 tests locally, with 3 skipped.
Facturapi Test issuance and both XML/PDF downloads were verified separately.
