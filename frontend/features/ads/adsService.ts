import mobileAds from "react-native-google-mobile-ads";

import { ADS_ENABLED } from "../../utils/platformFeatures";
import { reportStartupFailed, reportStartupOutcome } from "./adsTelemetry";

/**
 * One-time AdMob startup.
 *
 * No consent step: Bluai is distributed only in Mexico, where no ad-consent
 * form is required. Google's consent SDK (UMP) is still bundled with this
 * library, but calling it without a consent message configured in AdMob fails
 * with "Publisher misconfiguration" on every launch. If the app ever ships to
 * the EEA/UK, configure a GDPR message in AdMob (Privacy & messaging) and call
 * `AdsConsent.gatherConsent()` here, BEFORE `initialize()` — initializing can
 * start preloading ads, so consent must exist first.
 *
 * Idempotent: every caller gets the same promise. `_layout.tsx` kicks it off at
 * launch, and `AdBanner` awaits it before requesting an ad. It resolves to
 * whether ads may be requested this session and never rejects — a failure here
 * means "no ads", never a crash in an emergency app.
 */

let ready: Promise<boolean> | null = null;

export const initAds = (): Promise<boolean> => {
  if (!ready) ready = start();
  return ready;
};

const start = async (): Promise<boolean> => {
  if (!ADS_ENABLED) return false;

  try {
    await mobileAds().initialize();
    reportStartupOutcome("ready");
    return true;
  } catch (error) {
    reportStartupFailed(error);
    reportStartupOutcome("startup-failed");
    return false;
  }
};
