import { TestIds } from "react-native-google-mobile-ads";

/**
 * The banner's ad unit ID.
 *
 * Google's test unit everywhere except a production build that has a real ID
 * configured. Test ads are always filled, labelled "Test Ad" and safe to tap;
 * tapping a *real* ad on a team phone counts as invalid traffic and can get the
 * AdMob account suspended, so a dev build must never be able to load one.
 *
 * `EXPO_PUBLIC_ADMOB_BANNER_ANDROID` is set only in the `production` profile of
 * `eas.json`. Unit IDs are public client config, not secrets.
 */
const REAL_BANNER_UNIT_ID = process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID;

export const BANNER_UNIT_ID =
  !__DEV__ && REAL_BANNER_UNIT_ID
    ? REAL_BANNER_UNIT_ID
    : TestIds.ADAPTIVE_BANNER;
