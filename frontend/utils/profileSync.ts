import * as Sentry from "@sentry/react-native";
import { getAuth } from "@react-native-firebase/auth";
import { authFetch, isTimeoutError } from "./api";
import { API_BASE_URL } from "./config";
import {
  getStoredProfile,
  isProfileSynced,
  markProfileSynced,
} from "../app/onboarding/_services/onboardingService";
import type { OnboardingData } from "../app/onboarding/_types";

/**
 * Envío del perfil del onboarding al servidor, con reintento.
 */

/** Anchos de columna del backend. Deben coincidir con `users` en `main.py`. */
const MAX_LENGTHS: Record<string, number> = {
  first_name: 100,
  last_name: 100,
  phone: 30,
  address_1: 255,
  address_2: 255,
  zip_code: 10,
  state: 60,
  age_range: 10,
};

export type ProfileSyncFailureType =
  | "no-local-data" // no hay blob que mandar (usuario que nunca vio el wizard)
  | "uid-mismatch" // el blob es de otra cuenta — ver el guard más abajo
  | "no-profile-row" // 404: la fila de `users` aún no existe (carrera de arranque)
  | "unauthorized" // 401 tras el refresh de token que hace authFetch
  | "rejected" // otro 4xx: el payload es inválido y reintentar no lo arregla
  | "unreachable" // 5xx o error de red — reintentable
  | "timeout" // no respondió en PROFILE_PUSH_TIMEOUT_MS — reintentable
  | "unknown";

// Onboarding's "Finalizar" waits on this request. Without a cap, a slow backend left
// the button stuck on "Cargando…" — the same class of bug App Review rejected build
// 19 for. On timeout the user proceeds and the next launch retries.
const PROFILE_PUSH_TIMEOUT_MS = 10_000;

let syncInFlight = false;
let lastReportedKey: string | null = null;

function breadcrumb(message: string, data?: Record<string, unknown>) {
  console.log(`[ProfileSync] ${message}`, data ?? "");
  Sentry.addBreadcrumb({
    category: "profile-sync",
    level: "info",
    message,
    data,
  });
}

/**
 * Volcado verboso SOLO en desarrollo.
 *
 * Gated en `__DEV__` a propósito: este perfil trae nombre, teléfono y domicilio. En un
 * build de release esos valores acabarían en logcat, legibles por cualquier app con
 * permiso de leer logs — un problema de privacidad, no de ruido. En dev es justo lo que
 * hace falta para confirmar qué se guardó sin abrir Postgres.
 */
function devDump(label: string, payload: unknown) {
  if (!__DEV__) return;
  console.log(`[ProfileSync] ${label}\n${JSON.stringify(payload, null, 2)}`);
}

function reportFailure(
  type: ProfileSyncFailureType,
  message: string,
  ctx: { httpStatus?: number; fields?: string[] } = {},
) {
  const key = `${type}|${message}`;
  if (key === lastReportedKey) return;
  lastReportedKey = key;

  console.error(
    `[ProfileSync] ❌ FAILED type=${type} status=${ctx.httpStatus ?? "n/a"} msg="${message}"`,
  );

  Sentry.captureException(new Error(`profile-sync: ${type}`), {
    tags: {
      feature: "profile-sync",
      failureType: type,
      ...(ctx.httpStatus !== undefined
        ? { httpStatus: String(ctx.httpStatus) }
        : {}),
    },
    // Solo los NOMBRES de los campos. El payload trae nombre, teléfono y domicilio;
    // un reporte de error no es lugar para PII.
    extra: { message, fields: ctx.fields },
  });
}

function classify(status: number): ProfileSyncFailureType {
  if (status === 404) return "no-profile-row";
  if (status === 401) return "unauthorized";
  if (status >= 500) return "unreachable";
  if (status >= 400) return "rejected";
  return "unknown";
}

/** Recorta al ancho de la columna y avisa. Ver `buildProfilePayload`. */
function fit(key: string, value: string): string {
  const max = MAX_LENGTHS[key];
  if (max === undefined || value.length <= max) return value;
  reportFailure(
    "rejected",
    `field "${key}" exceeded ${max} chars (${value.length}) and was truncated`,
    { fields: [key] },
  );
  return value.slice(0, max);
}

/**
 * Mapea el estado del wizard al contrato del API.
 */
export function buildProfilePayload(
  data: OnboardingData,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};

  const strings: [string, string | undefined][] = [
    ["first_name", data.firstName],
    ["last_name", data.lastName],
    ["phone", data.phone],
    ["address_1", data.address1],
    ["address_2", data.address2],
    ["zip_code", data.zipCode],
    ["state", data.state],
    ["age_range", data.age],
  ];

  for (const [key, raw] of strings) {
    const trimmed = raw?.trim();
    if (trimmed) payload[key] = fit(key, trimmed);
  }

  const sliders: [string, number | undefined][] = [
    ["nervousness_level", data.nervousnessLevel],
    ["weather_info_level", data.weatherInfoLevel],
  ];

  for (const [key, value] of sliders) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 1 &&
      value <= 10
    ) {
      payload[key] = Math.round(value);
    }
  }

  return payload;
}

export interface ProfilePushResult {
  ok: boolean;
  failure?: ProfileSyncFailureType;
}

/**
 * Crea la fila de `users` si no existe. Idempotente (el backend hace upsert). Sin esto, un perfil pendiente necesitaría DOS arranques para sanar.
 */
async function ensureProfileRow(): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/v1/users/me`, {
      method: "POST",
    });
    if (!res.ok) {
      breadcrumb("could not create user row", { status: res.status });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Manda el perfil. `ok` solo es true si el SERVIDOR lo confirmó. */
export async function pushProfile(
  data: OnboardingData,
): Promise<ProfilePushResult> {
  const payload = buildProfilePayload(data);
  const fields = Object.keys(payload);

  if (fields.length === 0) {
    breadcrumb("nothing to send (empty payload)");
    return { ok: false, failure: "no-local-data" };
  }

  try {
    breadcrumb("sending profile", { fields });
    const res = await authFetch(`${API_BASE_URL}/api/v1/users/me/profile`, {
      method: "PUT",
      body: JSON.stringify(payload),
      timeoutMs: PROFILE_PUSH_TIMEOUT_MS,
    });

    // El punto entero del arreglo. `authFetch` devuelve el Response tal cual y NUNCA
    // mira `res.ok`, así que sin esta línea un 404 o un 500 pasan por éxito.
    if (!res.ok) {
      const type = classify(res.status);
      if (type === "no-profile-row") {
        // Benigno y conocido: la fila la crea POST /users/me al iniciar sesión. Se
        // reintenta en el próximo arranque. Breadcrumb, no evento.
        breadcrumb("user row not created yet — will retry next launch", {
          status: res.status,
        });
      } else {
        reportFailure(type, `PUT /users/me/profile responded ${res.status}`, {
          httpStatus: res.status,
          fields,
        });
      }
      return { ok: false, failure: type };
    }

    // El servidor responde con el perfil ya guardado, así que esto no es un "creo que
    // funcionó": es lo que quedó en la fila. En dev se imprime completo para poder
    // verificar el guardado sin abrir la base de datos.
    console.log(
      `[ProfileSync] ✅ SAVED (${res.status}) — ${fields.length} campos: ${fields.join(", ")}`,
    );
    try {
      const saved = await res.json();
      devDump("servidor confirmó:", {
        first_name: saved?.first_name,
        last_name: saved?.last_name,
        phone: saved?.phone,
        address_1: saved?.address_1,
        address_2: saved?.address_2,
        zip_code: saved?.zip_code,
        state: saved?.state,
        age_range: saved?.age_range,
        nervousness_level: saved?.nervousness_level,
        weather_info_level: saved?.weather_info_level,
      });
    } catch {
      // El cuerpo es informativo; que no se pueda leer no invalida un 2xx.
    }

    breadcrumb("profile saved", { fields });
    return { ok: true };
  } catch (err) {
    // authFetch RECHAZA si no hay sesión, si la red falla o si vence el timeout —
    // no devuelve un Response.
    const type: ProfileSyncFailureType = isTimeoutError(err)
      ? "timeout"
      : "unreachable";
    reportFailure(type, err instanceof Error ? err.message : String(err), {
      fields,
    });
    return { ok: false, failure: type };
  }
}

/**`
 * Reconciliación: manda el perfil si se debe.
 *
 * Un solo camino cubre los dos casos:
 *  - reintento tras un onboarding que falló por red
 *  - relleno de instalaciones viejas, que tienen el blob en disco y nada en el servidor
 *
 * Es seguro llamarla en cada arranque autenticado: si la marca está puesta, no hace
 * nada; y el endpoint es PUT, así que un reenvío de más es inofensivo.
 */
export async function syncProfileIfPending(): Promise<void> {
  if (syncInFlight) {
    console.log("[ProfileSync] ⏭️  ya hay un envío en curso — se omite");
    return;
  }
  syncInFlight = true;
  try {
    // Cada salida temprana se anuncia. Un "no pasó nada" sin explicación es
    // indistinguible de un bug, y es exactamente lo que costó encontrar el problema
    // original: el flujo fallaba en silencio y parecía estar bien.
    if (await isProfileSynced()) {
      console.log("[ProfileSync] ⏭️  perfil ya sincronizado — nada que hacer");
      return;
    }

    const stored = await getStoredProfile();
    if (!stored) {
      // Nada que mandar. No es un fallo: es el usuario que nunca pasó por el wizard.
      // Se sale sin tocar la red para que esto no cueste una petición por arranque.
      console.log(
        "[ProfileSync] ⏭️  no hay perfil local guardado — nada que mandar",
      );
      return;
    }

    const currentUid = getAuth().currentUser?.uid ?? null;
    if (!currentUid) {
      console.log("[ProfileSync] ⏭️  sin sesión activa — se reintenta después");
      return;
    }

    console.log("[ProfileSync] 🔄 perfil pendiente detectado — enviando…");

    // GUARD DE CUENTA. Las claves no están segmentadas por usuario y `signOut()` no
    // borra nada, así que en un teléfono compartido el blob puede ser de otra cuenta.
    // Sin esto, el relleno escribiría el domicilio del usuario A en el perfil de B.
    // Un blob viejo sin uid (grabado antes de este build) se manda: en ese momento no
    // existía el multi-cuenta en el dispositivo y el dueño es, casi siempre, el actual.
    if (stored.uid && stored.uid !== currentUid) {
      reportFailure(
        "uid-mismatch",
        "stored profile belongs to a different account",
      );
      return;
    }

    let result = await pushProfile(stored.data);

    // Un solo reintento, y solo para la carrera de arranque: creamos la fila y
    // volvemos a mandar. Cualquier otro fallo se deja para el próximo arranque —
    // insistir aquí sería reintentar en bucle algo que no va a cambiar en 200 ms.
    if (!result.ok && result.failure === "no-profile-row") {
      if (await ensureProfileRow()) {
        breadcrumb("user row created — retrying profile push");
        result = await pushProfile(stored.data);
      }
    }

    if (result.ok) {
      await markProfileSynced();
    }
  } catch (err) {
    // Backstop: nada aquí puede tumbar el arranque de la app.
    reportFailure("unknown", err instanceof Error ? err.message : String(err));
  } finally {
    syncInFlight = false;
  }
}
