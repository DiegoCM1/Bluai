# AdMob banner on the map screen

## Goal
Free-plan **Android** users see a Google AdMob banner between the map and the tab bar, paid-plan users see none, and it ships in the next store release. iOS keeps the SDK linked but shows no ads yet.

## Build
1. **Native setup** ✅ *(done on Android)*
   - `react-native-google-mobile-ads` **pinned to exactly `16.3.4`** (Google SDK Android 25.0.0 / iOS 13.1.0). Why not newer:
     - 17.1.0 has a Gradle bug on Expo.
     - 17.0.0 doesn't compile against RN 0.81.
     - 16.4.0+ ships Google SDK 25.4.0, built with Kotlin 2.3, and Expo 54 uses Kotlin 2.1.20.
     - Revisit on the Expo SDK 55 upgrade.
   - `app.json` plugin: Google's sample App IDs for both platforms, `delayAppMeasurementInit`, SKAdNetwork items. The iOS App ID stays because the SDK is linked on iOS.
   - Dev client verified on a Pixel 7: builds, installs, and the map opens without crashing.
2. **iOS build checkpoint** ✅ *(passed)*: an unsigned device build (`xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO`) → **BUILD SUCCEEDED**.
   - The Google SDK is linked (`GADMobileAds` symbols in `Bluai.debug.dylib`, plus the GMA and UMP resource bundles).
   - `GADApplicationIdentifier` is in the built `Info.plist`.
   - The fallback is not needed.
   - **Installing on an iPhone needs signing.** Hector's Apple Developer account is an *individual* enrollment, so only the account holder can sign. Use an **EAS development build** instead (`eas build --profile development --platform ios`, already in `eas.json`, after `eas device:create`), with Hector authorizing EAS once.
3. **`features/ads/` init (Android only):** UMP consent → `mobileAds().initialize()`, called once from `app/_layout.tsx`, skipped on iOS (`Platform.OS` check). The banner unit ID comes from `EXPO_PUBLIC_ADMOB_BANNER_ANDROID` in `eas.json`. `__DEV__` and the `preview` profile force `TestIds.ADAPTIVE_BANNER`.
4. **`useAdsEligibility()` + `AdBanner`:**
   - The eligibility hook reuses `getSubscription()` + `getCurrentPlanSlug()` and refreshes on focus and app resume, like `app/subscription/_hooks/useCurrentPlan.ts`. It starts in an **"unknown" state** (not `'free'`), so a paid user never sees an ad flash before the plan loads.
   - `AdBanner` (anchored adaptive) renders `null` on iOS. On Android it renders only when eligibility is known and the plan is `free`. Height is 0 until an ad loads, and it hides on load failure (offline). It is mounted in `app/(tabs)/MapScreen.tsx` as `<View flex-1><Main/><AdBanner/></View>`.
   - Unit test for the eligibility logic in `frontend/tests/*.test.cjs` (`node --test`), matching `membership-refresh.test.cjs`.
5. **Testing harness (the standard AdMob way):**
   - Google **test ad units** (`TestIds`) everywhere except `production`. They're always filled, labelled "Test Ad", and safe to click.
   - **Test device IDs** via `mobileAds().setRequestConfiguration({ testDeviceIdentifiers })`, so team phones get test ads even with real unit IDs.
   - **Ad Inspector** (`mobileAds().openAdInspector()`) behind a dev-only button.
   - **UMP debug geography**: `AdsConsent.requestInfoUpdate({ debugGeography: EEA, testDeviceIdentifiers })` in dev to test the EU form from Mexico, plus `AdsConsent.reset()` to replay it.
   - Manual Android checklist: free user sees the banner, paid user sees none, airplane mode collapses it, map FABs and tour spotlights sit above it. On iOS: the app opens and the map shows no banner.

## Fallback if the iOS build fails (verified possible, not the plan)
Exclude the library from iOS:
- Add `"expo": { "autolinking": { "ios": { "exclude": ["react-native-google-mobile-ads"] } } }` to `package.json`. Verified with the Podfile's own `expo-modules-autolinking react-native-config --platform ios` command: 20 → 19 native deps, and Android is unaffected.
- **Do not use** `react-native.config.js` with `platforms.ios: null`. Expo 54's `deepObjectMerge` swallows the `null` because the library declares its own iOS `scriptPhases`.
- The JS must then use **platform files**: `AdBanner.android.tsx` + `AdBanner.tsx` returning `null`, and the same for the init code. The library looks up its native module at import time (`TurboModuleRegistry.getEnforcing`), so importing it on iOS would crash once it's excluded. Precedent: `app/local-chat/_services/NearbyTransport.android.ts` / `.ios.ts`.
- Remove `iosAppId` / `skAdNetworkItems` from `app.json`. The plugin skips them and only warns.

## Not building
- **Ads on iOS**: deferred. Enabling them later needs:
  - rendering `AdBanner` on iOS,
  - an iOS banner unit ID,
  - generic ads (`requestNonPersonalizedAdsOnly`) or the ATT prompt (`expo-tracking-transparency`, a native store release),
  - the App Store privacy label update.
- Hiding the banner near hurricanes or during SOS: deferred by request. `AdBanner`'s visibility check gets one clear hook point for it.
- Ads on other tabs, and interstitial/rewarded/app-open ads: out of scope.
- Backend changes: AdMob is client-side, and plan data already comes from the existing subscription service.
- AdMob ↔ Firebase linking: optional (reporting only), deferred.
- Changing the shared `useCurrentPlan` hook: 4 screens and its tests depend on its current behavior.
- Upgrading past `16.3.4`: blocked by Kotlin until the Expo SDK 55 upgrade.

## Open questions - ASK BEFORE CODING
None. All resolved:
- Android-only ads (personalized, the SDK default); iOS has the SDK linked but no ads and no ATT.
- The AdMob account is decided.
- Paid plans see no ads.
- No emergency hiding yet.
- Ships in the next store release.

## Assumptions - proceeding unless corrected
- No AdMob account yet, so development uses Google's sample App IDs and test units.
- **AdMob account:** Luis's **personal Google account + individual payments profile** (Bluai isn't a registered company yet). One AdMob account holds many apps. When Bluai registers as a company, it moves to a new **business** AdMob account. That only changes the App IDs (`app.json`) and unit IDs (`eas.json`) and needs a store release; **the code stays the same**.
- **Firebase:** not linked to AdMob for now. When the Firebase project moves to the team account, **transfer ownership** of the existing project rather than recreating it (keeps Auth users, config files and FCM; no rebuild).
- **Release blockers you'll need to do yourself** (console work, not code):
  - Create the AdMob account: payments profile, US tax form (W-8BEN), mailed-PIN address verification.
  - Add Bluai for Android, and for iOS too: its real App ID replaces the sample one in `app.json` because the SDK is linked there. Mark it "not directed to children", and create one Android banner unit.
  - Set up the GDPR message in *Privacy & messaging*.
  - Publish `app-ads.txt` on the website listed in the store listings.
  - Add an ads section to the privacy policy / aviso de privacidad.
  - Update the **Play Data safety form**: advertising ID used for personalized advertising.
  - Review the **App Store privacy label**: the SDK is in the iOS binary but never initialized, so it collects nothing yet. Confirm against Google's App Store data-disclosure guide.
- Real unit IDs go in `eas.json`'s `production` profile only. They're public client config, not secrets.
- If the plan fetch fails, no ad is shown (fail closed). Offline, the ad wouldn't load anyway.
- UMP consent is included (AdMob requires it for EEA/UK users). It's a no-op for Mexican users.
- Placement is option A, map tab only, `ANCHORED_ADAPTIVE_BANNER`.
- `useFrameworks: "static"` (already set) is what the library requires. Package manager is npm.
- The `npm audit fix` lockfile churn (~60 unrelated packages) is split out of this PR. Restore the lock from `dev` and install only the ads library before committing.
- `runtimeVersion`/`version` bump is handled with the rest of the next store release, not in this PR.

## Riskiest unknown
The iOS native build (step 2): linking the Google Mobile Ads SDK alongside Firebase's `forceStaticLinking` + static frameworks. Checked early on purpose. The fallback removes the risk entirely.

## If time-boxed
Steps 1–4 with test IDs only, plus the Ad Inspector button. Skip the UMP debug-geography tooling.
