# AdMob banner on the map screen

## Goal
Free-plan users see a Google AdMob banner between the map and the tab bar, paid-plan users see none, and it ships in the next store release.

## Build
1. **Native setup:** install `react-native-google-mobile-ads` (and `expo-tracking-transparency` if ATT is chosen, see Open questions). Add the config plugin to `app.json` with **Google's public sample App IDs** (swapped for real ones before release), SKAdNetwork items and `delayAppMeasurementInit`. Rebuild the dev client on both platforms.
2. **`features/ads/` init:** UMP consent → (ATT) → `mobileAds().initialize()`, called once from `app/_layout.tsx`. Banner unit IDs come from `EXPO_PUBLIC_ADMOB_BANNER_IOS/ANDROID` in `eas.json`. In `__DEV__` and in the `preview` profile they are forced to `TestIds.ADAPTIVE_BANNER`.
3. **`AdBanner` component** (anchored adaptive): renders nothing until the plan is known and nothing for `safe`/`guard`/`edu` (via `getCurrentPlanSlug()`). Height is 0 until an ad loads, it hides on load failure (offline), and it reloads on foreground on iOS. Mounted in `app/(tabs)/MapScreen.tsx` as `<View flex-1><Main/><AdBanner/></View>`.
4. **Testing harness (the standard AdMob way):**
   - Google **test ad units** (`TestIds`) everywhere except `production`. These are always filled, labelled "Test Ad", and safe to click.
   - **Test device IDs** via `mobileAds().setRequestConfiguration({ testDeviceIdentifiers })`, so even a real unit ID serves test ads on team phones.
   - **Ad Inspector** (`mobileAds().openAdInspector()`) behind a dev-only button (e.g. in `NotificationTestScreen`/settings when `__DEV__`). It shows each request, its fill status and errors on the device.
   - **UMP debug geography**: `AdsConsent.requestInfoUpdate({ debugGeography: EEA, testDeviceIdentifiers })` in dev, so the EU consent form can be tested from Mexico, plus `AdsConsent.reset()` to replay it.
   - Manual device checklist: free user sees the banner, paid user sees none, airplane mode collapses it, map FABs and tour spotlights sit above it, on both Android and iOS.

## Not building
- Hiding the banner near hurricanes or during SOS: deferred by request. The `AdBanner` visibility check gets one clear hook point for it later.
- Ads on other tabs, and interstitial/rewarded/app-open ads: out of scope.
- Backend changes: AdMob is client-side, and plan data already comes from the existing subscription service.

## Open questions - ASK BEFORE CODING
1. iOS tracking prompt (ATT). **What it is:** Apple forces apps to ask "Allow Bluai to track your activity across other companies' apps and websites?" before ads can use the device's advertising ID. **Yes:** personalized ads, typically noticeably higher iOS revenue (most users still tap "Ask not to track"), but one more popup on top of location, notifications and contacts, in an emergency app. **No:** no popup, iOS gets non-personalized ads only. Adding it *later* needs another native store release. **My recommendation is No for this release.** Agree?

## Assumptions - proceeding unless corrected
- No AdMob account yet, so development uses Google's sample App IDs and test units. **Release blockers you'll need to do yourself** (console work, not code): create the AdMob account, add Bluai for iOS + Android, create one banner unit per platform, set up the GDPR message in *Privacy & messaging*, publish `app-ads.txt` on the website listed in both store listings, and update the App Store privacy label and Play Data safety form ("Advertising" / device identifiers).
- Real unit IDs go in `eas.json`'s `production` profile only. They're public client config, not secrets.
- If the plan fetch fails, no ad is shown (fail closed). Offline, the ad wouldn't load anyway.
- UMP consent is included (AdMob requires it for EEA/UK users). It's a no-op for Mexican users.
- Placement is option A, map tab only, `ANCHORED_ADAPTIVE_BANNER`.
- `useFrameworks: "static"` (already set) is what the library requires. Package manager is npm.
- `runtimeVersion`/`version` bump is handled with the rest of the next store release, not in this PR.

## Riskiest unknown
The iOS native build: linking the Google Mobile Ads SDK alongside Firebase's `forceStaticLinking` + static frameworks.

## If time-boxed
Steps 1–3 with test IDs only, plus the Ad Inspector button. Skip the UMP debug-geography tooling.
