# AdMob banner on the map screen

## Goal
Free-plan users see a Google AdMob banner between the map and the tab bar, paid-plan users see none, and it ships in the next store release.

## Build
1. **Native setup:** install `react-native-google-mobile-ads` (no `expo-tracking-transparency`: ATT is skipped this release). Add the config plugin to `app.json` with **Google's public sample App IDs** (swapped for real ones before release), SKAdNetwork items and `delayAppMeasurementInit`. Rebuild the dev client on both platforms.
2. **`features/ads/` init:** UMP consent → `mobileAds().initialize()`, called once from `app/_layout.tsx`. Banner unit IDs come from `EXPO_PUBLIC_ADMOB_BANNER_IOS/ANDROID` in `eas.json`. In `__DEV__` and in the `preview` profile they are forced to `TestIds.ADAPTIVE_BANNER`.
3. **`useAdsEligibility()` + `AdBanner`:**
   - The eligibility hook reuses `getSubscription()` + `getCurrentPlanSlug()` and refreshes on focus and app resume, like `app/subscription/_hooks/useCurrentPlan.ts`. It differs in two ways:
     - It fetches **on every platform**, ignoring `PAYMENTS_ENABLED`. Otherwise iOS users who paid on the website would see ads, because that flag is off on iOS.
     - It starts in an **"unknown" state** (not `'free'`), so a paid user never sees an ad flash before the plan loads.
   - The `AdBanner` component (anchored adaptive) renders only when eligibility is known and the plan is `free`. Height is 0 until an ad loads, it hides on load failure (offline), and it reloads on foreground on iOS. It is mounted in `app/(tabs)/MapScreen.tsx` as `<View flex-1><Main/><AdBanner/></View>`.
   - Unit test for the eligibility logic in `frontend/tests/*.test.cjs` (`node --test`), matching the existing `membership-refresh.test.cjs` style.
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
- AdMob ↔ Firebase linking: optional (reporting only), deferred.
- **Personalized ads on iOS.** iOS banner requests set `requestNonPersonalizedAdsOnly: true` (generic ads), and there's no ATT prompt. Enabling them later needs `expo-tracking-transparency` + permission text, i.e. a native store release. **Android serves personalized ads** (the SDK default, no extra work). EEA/UK users' choice in the UMP consent form still overrides this on both platforms.
- Changing the shared `useCurrentPlan` hook: 4 screens and its tests depend on its current behavior, so the ads eligibility logic lives in its own hook.

## Open questions - ASK BEFORE CODING
None. All resolved:
- Personalized ads on Android; generic ads on iOS, with no ATT prompt.
- The AdMob account is decided.
- Paid plans see no ads.
- No emergency hiding yet.
- Ships in the next store release.

## Assumptions - proceeding unless corrected
- No AdMob account yet, so development uses Google's sample App IDs and test units.
- **AdMob account:** Luis's **personal Google account + individual payments profile** (Bluai isn't a registered company yet). One AdMob account holds many apps, so future personal apps can live there too. When Bluai registers as a company, it moves to a new **business** AdMob account. That only changes the App IDs (`app.json`) and unit IDs (`eas.json`) and needs a store release; **the code stays the same**.
- **Firebase:** not linked to AdMob for now. When the Firebase project moves to the team account, **transfer ownership** of the existing project rather than recreating it (keeps Auth users, config files and FCM; no rebuild).
- **Release blockers you'll need to do yourself** (console work, not code):
  - Create the AdMob account: payments profile, US tax form (W-8BEN), mailed-PIN address verification.
  - Add Bluai for iOS + Android, mark it "not directed to children", and create one banner unit per platform.
  - Set up the GDPR message in *Privacy & messaging*.
  - Publish `app-ads.txt` on the website listed in both store listings.
  - Add an ads section to the privacy policy / aviso de privacidad.
  - Update the **App Store privacy label**: required for any ads SDK, but with no "used to track you" entry since there's no ATT.
  - Update the **Play Data safety form**: advertising ID used for personalized advertising.
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
