import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { getSubscription } from "../../app/subscription/_services/subscriptionService";
import { getCurrentPlanSlug } from "../../app/subscription/_utils/planAccess";
import { ADS_ENABLED } from "../../utils/platformFeatures";
import { initAds } from "./adsService";

/**
 * Whether this user should see ads right now.
 *
 * Three states, not a boolean: `"unknown"` until the plan has actually loaded,
 * so a paying user never sees an ad flash in and back out. That's also why
 * this doesn't reuse `useCurrentPlan`, which starts at `'free'` — harmless for
 * feature locks (a lock briefly shows, then opens), wrong for ads.
 *
 * Fails closed: a failed plan fetch or an SDK that couldn't start means no ad.
 * Revalidates on focus and on app resume, like `useCurrentPlan`, so someone who
 * just paid on the website loses the banner when they come back to the app.
 */

export type AdsEligibility = "unknown" | "show" | "hide";

export function useAdsEligibility(): AdsEligibility {
  const [eligibility, setEligibility] = useState<AdsEligibility>(
    ADS_ENABLED ? "unknown" : "hide",
  );
  useFocusEffect(
    useCallback(() => {
      if (!ADS_ENABLED) return;
      let active = true;
      let sequence = 0;
      async function refresh() {
        const request = ++sequence;
        let next: AdsEligibility;
        try {
          const [sdkReady, subscription] = await Promise.all([
            initAds(),
            getSubscription(),
          ]);
          next =
            sdkReady && getCurrentPlanSlug(subscription) === "free"
              ? "show"
              : "hide";
        } catch {
          next = "hide";
        }
        if (active && request === sequence) setEligibility(next);
      }
      void refresh();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
        listener.remove();
      };
    }, []),
  );
  return eligibility;
}
