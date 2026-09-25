import * as Sentry from "@sentry/react-native";

import { initAnalytics, track } from "../../utils/analytics";

/**
 * Ads observability, split by what each tool is for:
 *
 *  - Mixpanel gets every outcome (startup result, banner loaded/failed), so the
 *    fill rate and "why no ads" breakdown are measurable per build.
 *  - Sentry gets only failures someone has to act on — a misconfigured consent
 *    message, an SDK that won't start, an invalid ad request. `no-fill` and
 *    `network-error` are routine (no inventory; a phone offline mid-hurricane)
 *    and would bury the real errors, so they never reach Sentry.
 *
 * Impressions, clicks and revenue are left to the AdMob dashboard, which
 * measures them authoritatively.
 *
 * Mirrors `utils/pushTelemetry.ts`: a synthetic Error per failure type for a
 * stable Sentry grouping key, low-cardinality tags, and a de-dupe guard.
 */

export type AdsStartupOutcome = "ready" | "no-consent" | "startup-failed";

/** Banner error codes that are normal operation, not bugs. */
const EXPECTED_BANNER_CODES = new Set([
  "no-fill",
  "mediation-no-fill",
  "network-error",
]);

/** `googleMobileAds/no-fill` → `no-fill`. */
const bannerErrorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string"
    ? code.replace(/^googleMobileAds\//, "")
    : "unknown";
};

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Mixpanel only records once it's initialized, and ads startup can finish
 * before `_layout`'s first `initAnalytics()` does — so wait for it here.
 */
const trackEvent = (event: string, props?: Record<string, unknown>) => {
  void initAnalytics()
    .then(() => track(event, props))
    .catch(() => {});
};

let lastReportedKey: string | null = null;

/** Once-per-distinct-failure Sentry report. */
const reportFailure = (type: string, error: unknown) => {
  const message = toMessage(error);
  const key = `${type}|${message}`;
  if (key === lastReportedKey) return;
  lastReportedKey = key;

  Sentry.captureException(new Error(`ads: ${type}`), {
    tags: { feature: "ads", failureType: type },
    extra: { message },
  });
};

export const reportConsentFailed = (error: unknown) => {
  console.warn("[ads] consent update failed, using last known consent:", error);
  reportFailure("consent-failed", error);
};

export const reportStartupFailed = (error: unknown) => {
  console.warn("[ads] startup failed, no ads this session:", error);
  reportFailure("startup-failed", error);
};

export const reportStartupOutcome = (
  outcome: AdsStartupOutcome,
  consentFailed: boolean,
) => {
  console.log(
    `[ads] startup outcome=${outcome} consentFailed=${consentFailed}`,
  );
  trackEvent("ads_startup", { outcome, consent_failed: consentFailed });
};

export const reportBannerLoaded = () => {
  console.log("[ads] banner loaded");
  trackEvent("ad_banner_loaded");
};

export const reportBannerFailed = (error: unknown) => {
  const code = bannerErrorCode(error);
  console.warn(`[ads] banner failed to load code=${code}:`, error);
  trackEvent("ad_banner_failed", { code });
  if (!EXPECTED_BANNER_CODES.has(code)) reportFailure(`banner-${code}`, error);
};
