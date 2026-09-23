import { Platform } from "react-native";

/**
 * Build-time feature flags for the iOS App Store build.
 *
 * iOS ships ahead of two features that are real on Android but not yet on
 * iPhone, and shipping either one visible on iOS trips App Review:
 *
 *  - a purchase surface that isn't StoreKit violates Guideline 3.1.1, and
 *    linking out to a web checkout violates 3.1.3;
 *  - a screen that says "próximamente" is the textbook Guideline 2.1
 *    App Completeness rejection.
 *
 * These are deliberately NOT runtime toggles. `Platform.OS` resolves when Metro
 * bundles, so the guarded routes are unreachable in the shipped binary — deep
 * links included — rather than merely hidden behind a button that isn't drawn.
 *
 * Flip each one back in the same PR that makes its feature real.
 */

/**
 * Gates every purchase surface: the `/subscription` route tree, the upgrade
 * walls, and the plan gating in `planAccess`. While false every feature reads
 * as unlocked, so no screen can render a paywall pointing at a route that no
 * longer exists.
 *
 * Restore when in-app purchases go through StoreKit. Note the product decision
 * to move checkout to the website — if that holds, this stays false on iOS and
 * the in-app checkout is deleted rather than restored.
 */
export const PAYMENTS_ENABLED = Platform.OS !== "ios";

/**
 * Gates the Bluetooth mesh chat. `NearbyTransport.ios.ts` is a stub reporting
 * `isAvailable: false` (Google Nearby Connections is Android-only), so on
 * iPhone the feature can only ever show a "coming soon" dead end.
 *
 * Restore when MultipeerConnectivity lands behind the same transport interface.
 */
export const LOCAL_CHAT_ENABLED = Platform.OS !== "ios";
