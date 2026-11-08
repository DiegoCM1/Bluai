import "../../global.css";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import Main from "../map";
import { AdBanner } from "../../features/ads/AdBanner";

type FocusParams = {
  alertLat?: string;
  alertLon?: string;
  alertTitle?: string;
  alertLevel?: string;
  alertSosPhone?: string;
};

const MapScreen = () => {
  const params = useLocalSearchParams<FocusParams>();

  // Route params get reset to empty a few seconds after arriving here (unrelated
  // navigation elsewhere touches this same route). Freeze the first non-empty
  // arrival so the SOS banner / focus marker survive that reset instead of
  // vanishing right after the user gets here; only a genuinely new focus request
  // overwrites it, and dismissing the banner clears it explicitly.
  const [focus, setFocus] = useState<FocusParams>(params);
  // Deps are intentionally the individual primitives above, not `params` itself
  // (a new object reference every render, which would defeat the freeze).
  useEffect(() => {
    if (params.alertLat || params.alertTitle || params.alertSosPhone !== undefined) {
      setFocus(params);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.alertLat, params.alertLon, params.alertTitle, params.alertLevel, params.alertSosPhone]);

  const { alertLat, alertLon, alertTitle, alertLevel, alertSosPhone } = focus;
  const focusLat = alertLat ? parseFloat(alertLat) : undefined;
  const focusLon = alertLon ? parseFloat(alertLon) : undefined;

  console.log('[QA_MAP] MapScreen params | alertLat:', alertLat, '| alertLon:', alertLon, '| focusLat:', focusLat, '| focusLon:', focusLon);

  return (
    <>
      <StatusBar style="light" translucent={false} />
      {/* Column: the map takes the remaining height and the banner sits below
          it, so the map's bottom-anchored controls move up with the banner
          instead of being covered by it. */}
      <View className="flex-1">
        <Main
          focusLat={focusLat}
          focusLon={focusLon}
          focusTitle={alertTitle}
          focusLevel={alertLevel ? parseInt(alertLevel, 10) : undefined}
          focusSosPhone={alertSosPhone}
          onDismissFocus={() => setFocus({})}
        />
        <AdBanner />
      </View>
    </>
  );
};

export default MapScreen;
