import * as Sentry from "@sentry/react-native";
import * as Device from "expo-device";
import { Platform } from "react-native";

export { toMessage } from "../../utils/pushTelemetry";

/**
 * OBSERVABILITY for sign-in.
 *
 * App Review rejected build 18 (iPad Air M3, iPadOS 27) because tapping Sign in
 * with Apple "does not action". We had zero telemetry for it: the failure mode was
 * a native promise that never settled, so nothing threw, nothing was caught, and
 * Sentry never heard about it. We learned about it from Apple, three weeks late.
 *
 * This module names every way sign-in can go wrong, records the PHASE it happened
 * in, and reports it loudly (console + Sentry) with the device context that the
 * rejection hinged on — iPad vs iPhone, model, OS version. Like `pushTelemetry`,
 * it does NOT recover from failures; callers decide what to do.
 *
 * Mirrors `utils/pushTelemetry.ts` deliberately: same synthetic-Error grouping,
 * same tags/extra split, same de-dupe guard.
 */

export type AuthProviderName = "apple" | "google";

/** Where in the sign-in pipeline we are. */
export type AuthPhase =
  | "tap" // the button handler started
  | "nonce" // building the Apple nonce
  | "sheet" // the native Apple / Google UI is (supposed to be) on screen
  | "provider-credential" // the provider handed back a token
  | "firebase" // signInWithCredential
  | "routing"; // AuthGate deciding where a signed-in user lands (POST /users/me)

/** The named failure taxonomy. */
export type AuthFailureType =
  | "sheet-not-presented" // apple — iOS never showed the sheet (the build-18 signature)
  | "sheet-timeout" // apple — sheet shown, never returned
  | "cancel-without-sheet" // apple — "canceled" arrived but the sheet never appeared: a system failure, not the user
  | "no-identity-token" // both — provider succeeded but returned no token
  | "provider-error" // both — the native Apple/Google SDK threw something other than cancel
  | "firebase-rejected" // both — signInWithCredential threw (provider disabled, network, bad nonce)
  | "profile-timeout" // both — AuthGate POST /users/me never answered
  | "profile-failed" // both — AuthGate POST /users/me answered non-OK or threw
  | "unknown";

export interface AuthFailure {
  type: AuthFailureType;
  phase: AuthPhase;
  message: string;
}

/**
 * Per-attempt context. Platform / device fields are derived internally so no call
 * site can forget them — they're exactly what the next rejection will hinge on.
 */
export interface AuthTelemetryContext {
  provider: AuthProviderName;
  /** Native error code (`ERR_REQUEST_CANCELED`, `auth/operation-not-allowed`, …). */
  code?: string;
  /** ms since the tap — tells "instant failure" apart from "hung, then gave up". */
  elapsedMs?: number;
  /** HTTP status, for profile-* failures. */
  httpStatus?: number;
}

/** Spanish copy shown to the user for each failure. `null` ⇒ stay silent. */
export const AUTH_FAILURE_COPY: Record<AuthFailureType, string | null> = {
  "sheet-not-presented":
    "No se pudo abrir el inicio de sesión. Intenta de nuevo.",
  "sheet-timeout": "El inicio de sesión tardó demasiado. Intenta de nuevo.",
  "cancel-without-sheet":
    "No se pudo abrir el inicio de sesión. Intenta de nuevo.",
  "no-identity-token": "No se pudo iniciar sesión. Intenta de nuevo.",
  "provider-error": "No se pudo iniciar sesión. Intenta de nuevo.",
  "firebase-rejected":
    "No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.",
  // Routing has its own fallback (onboarding) — the user is already signed in, so
  // an error message here would be wrong.
  "profile-timeout": null,
  "profile-failed": null,
  unknown: "No se pudo iniciar sesión. Intenta de nuevo.",
};

// De-dupe guard: a watchdog and a late native rejection can both report the same
// attempt. Report each distinct failure once per attempt.
let lastReportedKey: string | null = null;

/** Call at the start of every sign-in attempt so its failures report fresh. */
export function resetAuthFailureReporting() {
  lastReportedKey = null;
}

/** Loud, once-per-distinct-failure report: console + Sentry. */
export function reportAuthFailure(
  failure: AuthFailure,
  ctx: AuthTelemetryContext,
  level: Sentry.SeverityLevel = "error",
) {
  const key = `${ctx.provider}|${failure.type}|${failure.phase}|${failure.message}`;
  if (key === lastReportedKey) return;
  lastReportedKey = key;

  console.error(
    `[Auth] FAILURE provider=${ctx.provider} type=${failure.type} phase=${failure.phase} ` +
      `platform=${Platform.OS} isPad=${Platform.OS === "ios" && Platform.isPad} ` +
      `code=${ctx.code ?? "n/a"} elapsedMs=${ctx.elapsedMs ?? "n/a"} msg="${failure.message}"`,
  );

  // Tags must be low-cardinality strings — they're what you filter a dashboard by.
  const tags: Record<string, string> = {
    feature: "auth",
    provider: ctx.provider,
    failureType: failure.type,
    phase: failure.phase,
    platform: Platform.OS,
    isPad: String(Platform.OS === "ios" && Platform.isPad),
  };
  if (ctx.code) tags.code = ctx.code;
  if (ctx.httpStatus !== undefined) tags.httpStatus = String(ctx.httpStatus);

  Sentry.captureException(new Error(`auth: ${failure.type}`), {
    level,
    tags,
    extra: {
      message: failure.message,
      elapsedMs: ctx.elapsedMs,
      httpStatus: ctx.httpStatus,
      modelName: Device.modelName,
      osVersion: Device.osVersion,
      isDevice: Device.isDevice,
    },
  });
}

/** A stage breadcrumb so a Sentry event shows the path that led to the failure. */
export function authBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
) {
  console.log(`[Auth] ${message}`, data ?? "");
  Sentry.addBreadcrumb({
    category: "auth",
    level: "info",
    message,
    data,
  });
}
