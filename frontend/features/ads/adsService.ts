import mobileAds, { AdsConsent } from "react-native-google-mobile-ads";

import { ADS_ENABLED } from "../../utils/platformFeatures";
import {
  reportConsentFailed,
  reportStartupFailed,
  reportStartupOutcome,
} from "./adsTelemetry";

/**
 * One-time AdMob startup: consent first, then the SDK.
 *
 * The order is Google's requirement, not a preference — `initialize()` can
 * start preloading ads, so the user's consent choice (the UMP form, shown only
 * in the EEA/UK) has to exist before it runs.
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

  let consentFailed = false;
  try {
    let canRequestAds: boolean;
    try {
      ({ canRequestAds } = await AdsConsent.gatherConsent());
    } catch (error) {
      // Offline, or the consent message isn't configured in AdMob yet. Fall
      // back to the choice stored from a previous session, as Google's UMP
      // samples do; with none stored this is false and the session has no ads.
      consentFailed = true;
      reportConsentFailed(error);
      ({ canRequestAds } = await AdsConsent.getConsentInfo());
    }
    if (!canRequestAds) {
      reportStartupOutcome("no-consent", consentFailed);
      return false;
    }

    await mobileAds().initialize();
    reportStartupOutcome("ready", consentFailed);
    return true;
  } catch (error) {
    reportStartupFailed(error);
    reportStartupOutcome("startup-failed", consentFailed);
    return false;
  }
};
