# Payment demo: staging and production

| Setting / step | Internal demo | Real customers |
| --- | --- | --- |
| App API | Railway staging | Railway production |
| Website branch | dev (Vercel Preview) | main (Vercel Production) |
| Website BLUAI_API_URL | https://backend-blueye-staging.up.railway.app | https://backend-blueye-production.up.railway.app |
| Website BLUAI_PAYMENT_MODE | test | live |
| Railway STRIPE_MODE | test | live |
| Secret key | STRIPE_TEST_SECRET_KEY | STRIPE_SECRET_KEY |
| Webhook secret | STRIPE_TEST_WEBHOOK_SECRET | STRIPE_WEBHOOK_SECRET |
| Four recurring prices | STRIPE_TEST_PRICE_{SAFE,GUARD}_{MONTHLY,ANNUAL} | STRIPE_PRICE_{SAFE,GUARD}_{MONTHLY,ANNUAL} |
| WEB_PAYMENTS_ORIGIN | Actual deployed dev website origin | https://www.bluai.com.mx |
| Database | staging only | production only |

The selected key, prices and webhook must all belong to the same Stripe sandbox
or live account. Missing sandbox variables never fall back to live ones.
Production rejects test mode; staging rejects live mode. The website also checks
the backend mode before forwarding membership requests.

## Setup still required outside the repository

1. Create a sandbox in Stripe, and four recurring Prices. Put the sandbox secret,
   Price IDs and webhook secret in Railway staging using the names above.
2. Configure the sandbox webhook for the staging backend:
   `/api/v1/payments/webhook/stripe`, events checkout.session.completed,
   customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
3. Configure Vercel Preview variables scoped to dev: BLUAI_API_URL,
   BLUAI_PAYMENT_MODE and the existing Firebase web app public configuration.
   Authorize the actual dev hostname in Firebase Auth. Production variables must
   stay scoped to Production. The Firebase project must match the selected backend.
4. Deploy backend and web dev PRs. Set WEB_PAYMENTS_ORIGIN to the deployed dev
   origin and WEB_PAYMENTS_ENABLED=true only when the sandbox is configured.
5. Build/install the updated staging app. The previously uploaded APK predates
   these changes; its existing file must not be presented as the updated demo.

## Record the real journey on an Android device

Use a dedicated free account in staging and the same sign-in provider in the web.
Start Android screen recording before opening the app (or use adb shell screenrecord).

1. Show the Free plan and a blocked paid feature.
2. Select Safe or Guard and show the external dev membership page.
3. Sign in with the same account. Show the test-environment banner and price.
4. Open Stripe Checkout and use test card 4242 4242 4242 4242, any future expiry
   and three-digit CVC. Never use a real card for this demo.
5. Return to the website and wait for the signed webhook to mark the plan active.
6. Tap Return to Bluai. Show the new plan after the app refreshes, then open the
   implemented paid feature. Verify Safe does not unlock Guard-only entitlements.
7. Show renewal cancellation and verify access remains until period end.

Repeat with a fresh account for Guard. Negative cases: abandoned checkout, declined
card 4000 0000 0000 0002, delayed webhook, repeated payment click, and wrong web/app
account. These must not unlock a plan or create duplicate subscriptions.

Evidence must distinguish automated tests with provider mocks from a real Stripe
sandbox payment. No device recording or sandbox E2E run is claimed until performed.
The entitlement matrix does not prove that every advertised product feature has
been implemented; demonstrate actual working screens separately.

Stripe test cards: https://docs.stripe.com/testing
