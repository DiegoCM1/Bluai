/**
 * Tour identity, persistence keys, and step indices.
 *
 * Step indices are named constants on purpose: `AttachStep index={n}` is
 * positional, so a raw number couples the JSX (spread across several screens)
 * to the position of an entry in the steps array. Inserting a step would then
 * silently re-point every later spotlight at the wrong element. Named keys make
 * that a non-event — which is what keeps the deferred interactive steps
 * (docs/TUTORIALS.md) additive rather than a rewrite.
 */

import type { TourId } from "./types";
import { LOCAL_CHAT_ENABLED } from "../../utils/platformFeatures";

/**
 * Master kill switch. Set to `false` to disable every tutorial app-wide
 * without reverting any code: `TourProvider` renders its children untouched,
 * and `useTourGate` never fires.
 *
 * This exists so a tour bug found after release is a one-line fix rather than
 * an unpick of edits across four screens.
 */
export const TOURS_ENABLED = true;

export const TOUR_IDS = {
  map: "map",
  more: "more",
} as const;

/** AsyncStorage keys — same `@blueye_` prefix as `onboardingService.ts`. */
export const TOUR_STORAGE_KEYS: Record<TourId, string> = {
  map: "@blueye_tour_map_seen",
  more: "@blueye_tour_more_seen",
};

/** Tutorial 1 — MapScreen. Order matches `mapTourSteps`. */
export const MAP_TOUR = {
  MAP: 0,
  SOS: 1,
  AI_TAB: 2,
  ALERTS_TAB: 3,
  REPORT: 4,
} as const;

/**
 * Tutorial 2 — MoreScreen. Order matches `moreTourSteps`.
 *
 * Platform-derived: the offline-chat card isn't rendered where local chat is
 * disabled (see `utils/platformFeatures`), so its step doesn't exist there and
 * SOS contacts shifts to index 0. `moreTourSteps` reads the same flag, and the
 * two must agree — a step whose card is absent spotlights nothing.
 */
export const MORE_TOUR = {
  OFFLINE_CHAT: LOCAL_CHAT_ENABLED ? 0 : undefined,
  SOS_CONTACTS: LOCAL_CHAT_ENABLED ? 1 : 0,
} as const;

/**
 * Routes in `MoreScreen`'s `items` array that carry a spotlight.
 *
 * Keyed by route rather than list position on purpose: `items` is built
 * conditionally (`IS_DEV_BUILD`, plus the platform flags above), so an index
 * would silently re-point a bubble at the wrong card the next time someone
 * edits the list. `MoreScreen` asserts that every key here matches a real item
 * and that every step has an anchor — but only under `__DEV__`, so a release
 * build will not warn you. Walk the tour on a device after changing either.
 *
 * `| undefined` is deliberate — most routes are not targets, and the lookup
 * must admit that rather than claiming a number for every string.
 */
export const MORE_TOUR_ROUTES: Record<string, number | undefined> = {
  ...(LOCAL_CHAT_ENABLED ? { "/local-chat": MORE_TOUR.OFFLINE_CHAT } : {}),
  "/SOSContactsScreen": MORE_TOUR.SOS_CONTACTS,
};
