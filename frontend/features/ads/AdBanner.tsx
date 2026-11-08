import { useRef, useState } from "react";
import { View } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";

import { reportBannerFailed, reportBannerLoaded } from "./adsTelemetry";
import { BANNER_UNIT_ID } from "./constants";
import { useAdsEligibility } from "./useAdsEligibility";

/**
 * Anchored adaptive banner, laid out in the normal flow (not absolutely
 * positioned) so whatever sits above it shrinks to make room. On the map that
 * means the map and every control pinned to its bottom edge move up with it.
 *
 * Takes no space until an ad arrives: `BannerAd` starts at 0×0 and only grows
 * on load. If the first load fails (offline, no fill) it unmounts instead of
 * leaving an empty strip. Renders nothing on iOS or for paid plans.
 */
export function AdBanner() {
  const eligibility = useAdsEligibility();
  const [failed, setFailed] = useState(false);
  const hasLoaded = useRef(false);

  if (eligibility !== "show" || failed) return null;

  return (
    <View className="items-center">
      <BannerAd
        unitId={BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => {
          hasLoaded.current = true;
          reportBannerLoaded();
        }}
        onAdFailedToLoad={(error) => {
          reportBannerFailed(error);
          // A failed *refresh* keeps showing the previous ad, so only collapse
          // when nothing ever loaded.
          if (!hasLoaded.current) setFailed(true);
        }}
      />
    </View>
  );
}
