// frontend/utils/pushNotifications.js
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as IntentLauncher from "expo-intent-launcher";
import { Alert, DeviceEventEmitter, Linking, Platform } from "react-native";
import { toast } from "sonner-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
// iOS-only at runtime (see react-native.config.js — this package is unlinked on
// Android). The *import* is safe on both platforms: messaging's module scope only
// writes into RNFB's JS namespace registry (`createModuleNamespace`), it never
// touches NativeModules. The native lookup happens on the first getMessaging()
// call, which is why that call must stay behind a Platform.OS === 'ios' branch.
import {
  getAPNSToken,
  getMessaging,
  getToken as getFcmRegistrationToken,
  isDeviceRegisteredForRemoteMessages,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  type Messaging,
} from '@react-native-firebase/messaging';
import { track } from "./analytics";
import { authFetch } from './api'
import { API_BASE_URL } from './config'
import {
  PUSH_FAILURE_COPY,
  classifyBackendStatus,
  pushBreadcrumb,
  redactToken,
  reportPushFailure,
  resetPushFailureReporting,
  toMessage,
  type PushFailureType,
} from './pushTelemetry'

const BATTERY_OPT_ASKED_KEY  = '@blueeye:battery_opt_asked';
const HEADS_UP_ASKED_KEY     = '@blueeye:heads_up_asked_v2'; // v2 = sos_emergency channel

export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const alreadyAsked = await AsyncStorage.getItem(BATTERY_OPT_ASKED_KEY);
    if (alreadyAsked) return;
    await AsyncStorage.setItem(BATTERY_OPT_ASKED_KEY, 'true');
  } catch { /* AsyncStorage unavailable — still show the dialog */ }

  Alert.alert(
    'Alertas de emergencia',
    'Para que Bluai pueda avisarte aunque el teléfono esté inactivo, necesita permiso para funcionar en segundo plano sin restricciones.',
    [
      { text: 'Ahora no', style: 'cancel' },
      {
        text: 'Permitir',
        onPress: async () => {
          try {
            await IntentLauncher.startActivityAsync(
              'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
              { data: 'package:com.bluai.app' }
            );
          } catch {
            // Si el intent falla (algunos OEM lo bloquean), abrir ajustes de la app
            await IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
              { data: 'package:com.bluai.app' }
            );
          }
        },
      },
    ]
  );
}

// Show once: ask the user to enable heads-up / floating notifications for the
// sos_emergency channel. Android lets apps open the exact channel settings screen so
// the user just needs to toggle "Mostrar en pantalla" (MIUI) / "Show as pop-up"
// (stock Android). Called after battery-opt so both dialogs don't overlap.
export async function requestHeadsUpPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const alreadyAsked = await AsyncStorage.getItem(HEADS_UP_ASKED_KEY);
    if (alreadyAsked) return;
    await AsyncStorage.setItem(HEADS_UP_ASKED_KEY, 'true');
  } catch { /* proceed */ }

  Alert.alert(
    'Notificaciones a pantalla completa',
    'Para que las alertas SOS aparezcan sobre cualquier pantalla (incluso con el teléfono bloqueado), activa "Mostrar en pantalla" en los ajustes del canal SOS.',
    [
      { text: 'Ahora no', style: 'cancel' },
      {
        text: 'Configurar',
        onPress: async () => {
          try {
            // Opens the exact sos_emergency channel settings where the user can
            // enable "Floating notifications" / "Show as pop-up" / "Mostrar en pantalla"
            await IntentLauncher.startActivityAsync(
              'android.settings.CHANNEL_NOTIFICATION_SETTINGS',
              {
                extra: {
                  'android.provider.extra.APP_PACKAGE': 'com.bluai.app',
                  'android.provider.extra.CHANNEL_ID': 'sos_emergency',
                },
              }
            );
          } catch {
            // Fallback: open the general app notification settings page
            await Linking.openSettings();
          }
        },
      },
    ]
  );
}

// Guarda `uid:token`, NO el token pelón. Un token de FCM es del *dispositivo*, así que
// al cambiar de cuenta sigue siendo el mismo: con el token solo como llave, el POST de la
// cuenta nueva se saltaba y esa cuenta se quedaba sin fila en `device_tokens` — sin push
// y reportando éxito. El backend ya hace `ON CONFLICT (token) DO UPDATE SET user_id`, o
// sea que el POST que nos ahorrábamos era justo el que arreglaba la fila.
const _LAST_TOKEN_KEY = 'push_last_registered_token';
// In-memory guard prevents concurrent calls with the same token from both POSTing
let _registrationInFlight: string | null = null;

/** Outcome of a registration attempt, so callers can react instead of guessing. */
export type PushRegistrationResult =
  | { ok: true }
  | { ok: false; type: PushFailureType };

// Telemetry must never be the thing that crashes the app: if Firebase isn't
// initialised yet, "no uid" is the honest answer, not an exception.
function _currentUid(): string | null {
  try {
    return getAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function _hasUid(): boolean {
  return _currentUid() !== null;
}

/**
 * iOS only. Resolves once APNs has actually handed us a device token.
 *
 * `registerDeviceForRemoteMessages()` resolving means "the register call was
 * accepted", NOT "a token has arrived". Worse, iOS persists
 * `isRegisteredForRemoteNotifications` across launches, so on every warm start the
 * call short-circuits and returns before APNs has delivered anything. Since
 * firebase-ios-sdk 10.4 the APNs token is a hard prerequisite for minting an FCM
 * token — getToken() called too early simply rejects. So we poll rather than trust
 * the await.
 */
const APNS_POLL_ATTEMPTS = 10;
const APNS_POLL_DELAY_MS = 300;

async function waitForApnsToken(
  messaging: Messaging,
  attempts = APNS_POLL_ATTEMPTS,
  delayMs = APNS_POLL_DELAY_MS,
): Promise<string | null> {
  for (let i = 0; i < attempts; i += 1) {
    const apnsToken = await getAPNSToken(messaging);
    if (apnsToken) return apnsToken;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * Returns an **FCM registration token** on both platforms, or null after having
 * already reported why it failed.
 *
 * The backend sends exclusively through `firebase_admin.messaging`, which can only
 * address FCM tokens — so "whatever token the OS handed us" is not good enough:
 *
 *  - Android: expo-notifications owns FCM delivery here (see react-native.config.js)
 *    and `getDevicePushTokenAsync()` already returns a real FCM token.
 *  - iOS: that same call returns the raw 64-hex APNs device token, which
 *    firebase_admin cannot route — pushes would be accepted by our own backend and
 *    then silently never delivered. Only the Firebase iOS SDK can exchange the APNs
 *    token for an FCM one, which is the entire reason
 *    @react-native-firebase/messaging is a dependency of this app.
 */
async function acquireFcmToken(): Promise<string | null> {
  if (Platform.OS !== "ios") {
    try {
      const { data } = await Notifications.getDevicePushTokenAsync();
      return data;
    } catch (err) {
      reportPushFailure(
        { type: "token-unavailable", message: toMessage(err), phase: "token" },
        { hasUid: _hasUid() },
      );
      return null;
    }
  }

  const messaging = getMessaging();

  try {
    // Idempotent, but checking first avoids a pointless bridge round-trip on
    // every warm start.
    if (!isDeviceRegisteredForRemoteMessages(messaging)) {
      await registerDeviceForRemoteMessages(messaging);
    }
  } catch (err) {
    reportPushFailure(
      {
        type: "apns-register-failed",
        message: toMessage(err),
        phase: "apns-register",
      },
      { hasUid: _hasUid() },
    );
    return null;
  }

  const apnsToken = await waitForApnsToken(messaging);
  if (!apnsToken) {
    // Registration was accepted but APNs never delivered. In practice this means a
    // provisioning problem, not a transient one: missing `aps-environment`
    // entitlement, Push Notifications not enabled on the App ID, or a build signed
    // for the wrong APNs environment.
    reportPushFailure(
      {
        type: "apns-token-timeout",
        message: `APNs no entregó un device token tras ${APNS_POLL_ATTEMPTS} intentos (${APNS_POLL_ATTEMPTS * APNS_POLL_DELAY_MS}ms)`,
        phase: "apns-register",
      },
      { hasUid: _hasUid() },
    );
    return null;
  }
  // Prefix only — an APNs token is a credential just like the FCM one.
  pushBreadcrumb("APNs device token acquired", {
    tokenPrefix: redactToken(apnsToken),
  });

  try {
    return await getFcmRegistrationToken(messaging);
  } catch (err) {
    reportPushFailure(
      { type: "token-unavailable", message: toMessage(err), phase: "token" },
      { hasUid: _hasUid() },
    );
    return null;
  }
}

export async function sendTokenToBackend(fcmToken: string): Promise<PushRegistrationResult> {
  // Leído antes del primer await: `currentUser` puede cambiar mientras corren los
  // reintentos, y el dedup tiene que hablar del usuario que motivó ESTE registro.
  const dedupeKey = `${_currentUid() ?? "anon"}:${fcmToken}`;

  // Another call already owns this token's outcome — not our failure to report.
  if (_registrationInFlight === dedupeKey) return { ok: true };
  _registrationInFlight = dedupeKey;  // set before any await — closes TOCTOU window

  const tokenPrefix = redactToken(fcmToken);
  let success = false;
  let failureType: PushFailureType = 'backend-unreachable';
  let lastMessage = '(no error object)';
  let lastStatus: number | undefined;
  let attempt = 0;

  try {
    // Persistent deduplication: skip if token already registered successfully
    try {
      const stored = await AsyncStorage.getItem(_LAST_TOKEN_KEY);
      if (stored === dedupeKey) {
        pushBreadcrumb('token already registered — skipping POST', { tokenPrefix });
        return { ok: true };             // finally handles _registrationInFlight = null
      }
    } catch {
      // AsyncStorage unavailable — proceed with registration
    }

    const MAX = 3;
    for (let i = 0; i < MAX; i++) {
      attempt = i + 1;
      try {
        const res = await authFetch(`${API_BASE_URL}/api/v1/push-token`, {
          method: 'POST',
          // `platform` decide la forma del payload que el backend puede mandar: un
          // push silencioso es `content-available` en iOS y un canal en Android, y
          // sin este campo no se pueden distinguir — un registration token de FCM es
          // opaco e idéntico en las dos plataformas.
          body: JSON.stringify({ token: fcmToken, platform: Platform.OS }),
        });
        if (res.ok) {
          try {
            await AsyncStorage.setItem(_LAST_TOKEN_KEY, dedupeKey);
          } catch { /* best-effort; next launch will re-POST (idempotent) */ }
          track('push_token_saved', { ok: true });
          pushBreadcrumb('token registered with backend', { tokenPrefix, attempt });
          success = true;
          break;
        }
        // Record WHY before deciding whether to retry. Breaking out of the loop
        // without capturing the reason is what made 4xx failures invisible.
        lastStatus = res.status;
        failureType = classifyBackendStatus(res.status);
        lastMessage = `HTTP ${res.status}`;
        if (res.status < 500) break;                       // 4xx permanente — no reintentar
      } catch (err) {
        failureType = 'backend-unreachable';               // error de red → reintentar
        lastMessage = toMessage(err);
        lastStatus = undefined;
      }
      if (i < MAX - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i)); // 1s → 2s
    }
  } finally {
    _registrationInFlight = null;
  }

  if (success) return { ok: true };

  reportPushFailure(
    { type: failureType, message: lastMessage, phase: 'backend' },
    { hasUid: _hasUid(), attempt, httpStatus: lastStatus, tokenPrefix },
  );
  track('push_token_saved', { ok: false, error: failureType });

  // Whether to interrupt the user is a per-failure decision, not an inference
  // from whether an error object happens to exist.
  const copy = PUSH_FAILURE_COPY[failureType];
  if (copy.notify) {
    toast.error(copy.title, { description: copy.description });
  }
  return { ok: false, type: failureType };
}

/**
 * Se suscribe a la *rotación* de token y devuelve el unsubscribe.
 *
 * Hay que llamar a APIs distintas por plataforma porque **el valor que emiten es
 * distinto**, no por gusto:
 *
 * - **iOS** → `onTokenRefresh` de RNFB, que emite un **registration token de FCM** — que es
 *   lo único que `firebase_admin` sabe enrutar. `addPushTokenListener` de expo aquí emitiría
 *   el **hex crudo de APNs**, y como `sendTokenToBackend` pisa el token guardado, una
 *   rotación borraría el token bueno adquirido en el arranque y dejaría la cuenta muda. El
 *   backend tampoco lo limpiaría: el fallo no es `UnregisteredError`, así que la lista
 *   blanca de `_PERMANENT_FAILURE_TYPES` (correctamente) lo conserva.
 * - **Android** → se queda `addPushTokenListener` de expo, **sin cambio de comportamiento**.
 *   RNFB messaging está deslinkeado ahí (`react-native.config.js`), así que `getMessaging()`
 *   reventaría — por eso la llamada vive detrás del branch de `Platform.OS`, igual que en
 *   `acquireFcmToken()` y como explica el comentario del import arriba.
 */
export function subscribeToTokenRefresh(
  onToken: (token: string) => void,
): () => void {
  if (Platform.OS === "ios") {
    // Mismo guard que registerForPushNotificationsAsync(): sin dispositivo físico
    // no hay APNs, y en Simulator el módulo nativo de RNFB puede ni existir.
    if (!Device.isDevice) {
      pushBreadcrumb("token refresh omitido — requiere dispositivo físico");
      return () => {};
    }
    try {
      return onTokenRefresh(getMessaging(), onToken);
    } catch (err) {
      // getMessaging() tira si el binario no trae RNFB messaging linkeado — o sea
      // cualquier dev client anterior a `1e704ea`. Esto NO puede propagarse: corre
      // sincrónico dentro del useEffect de AuthGate, así que un throw aquí no
      // degrada "no hay rotación de token", se lleva el render de toda la app.
      reportPushFailure(
        { type: "token-unavailable", message: toMessage(err), phase: "token" },
        { hasUid: _hasUid() },
      );
      return () => {};
    }
  }
  const sub = Notifications.addPushTokenListener(({ data }) => onToken(data));
  return () => sub.remove();
}

export async function setupNotificationChannels() {
  if (Platform.OS !== "android") return;
  // Delete old channel so Android re-creates it at MAX importance.
  // Android never upgrades a channel's importance once created; the only fix is
  // to delete and recreate with the new importance level.
  // No delete needed — sos_emergency is a new ID that has never existed on any
  // device, so Android creates it fresh at IMPORTANCE_MAX every time.
  await Notifications.setNotificationChannelAsync("sos_emergency", {
    name: "Alertas SOS",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    showBadge: true,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });
  // Invite / reject / contact-added pushes declare this channel id backend-side
  // (sos_contacts/service.py, sos_invite/service.py) but it was never created
  // here — Android silently fell back to its default channel (no heads-up, no
  // guaranteed sound) for all three, making a successfully-sent invite push
  // easy to miss entirely. HIGH (not MAX/bypassDnd) — important, but not the
  // "someone needs help right now" signal that sos_emergency is.
  await Notifications.setNotificationChannelAsync("sos_alerts", {
    name: "Contactos SOS",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    showBadge: true,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  // Silent channel for background data-refresh pushes — no banner, no sound, hidden in drawer
  await Notifications.setNotificationChannelAsync("contacts_refresh_silent", {
    name: "Sincronización de contactos",
    importance: Notifications.AndroidImportance.MIN,
    enableVibrate: false,
    showBadge: false,
  });
}

export async function registerForPushNotificationsAsync() {
  resetPushFailureReporting();

  if (!Device.isDevice) {
    pushBreadcrumb('skipped — push requires a physical device');
    return null;
  }

  // A failed channel must not cost us the token. This used to be a bare `await`:
  // any throw rejected the whole function, so permissions were never requested
  // and no token was ever fetched — with nothing but a console line to show it.
  try {
    await setupNotificationChannels();
  } catch (err) {
    reportPushFailure(
      { type: 'channel-setup-failed', message: toMessage(err), phase: 'channels' },
      { hasUid: _hasUid() },
    );
  }

  // 1) Permisos
  let finalStatus: string;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    finalStatus =
      existingStatus === "granted"
        ? existingStatus
        : (await Notifications.requestPermissionsAsync()).status;
  } catch (err) {
    reportPushFailure(
      { type: 'unknown', message: toMessage(err), phase: 'permissions' },
      { hasUid: _hasUid() },
    );
    return null;
  }

  track("push_permission", {
    status: finalStatus === "granted" ? "granted" : "denied",
  });

  if (finalStatus !== "granted") {
    // A declined permission is a user choice, not a defect — it belongs in the
    // Mixpanel funnel above, not in Sentry's "something is broken" dashboard.
    const copy = PUSH_FAILURE_COPY['permission-denied'];
    pushBreadcrumb('permission denied by user', { status: finalStatus });
    Alert.alert(copy.title, copy.description);
    return null;
  }

  // 2) Token de registro FCM (HTTP v1) — la ruta difiere por plataforma,
  //    ver acquireFcmToken(). Siempre devuelve un token FCM, nunca uno de APNs.
  const fcmToken = await acquireFcmToken();
  if (!fcmToken) return null; // acquireFcmToken ya reportó la causa exacta
  // Prefix only — a push token is a credential, and Sentry runs sendDefaultPii.
  pushBreadcrumb('FCM token acquired', { tokenPrefix: redactToken(fcmToken) });

  await sendTokenToBackend(fcmToken);

  // 3) Battery optimization exemption — solo aparece una vez
  void requestBatteryOptimizationExemption().catch((err) =>
    pushBreadcrumb('battery-opt dialog failed', { error: toMessage(err) }),
  );
  // 4) Heads-up / floating notifications — mostramos 2 s después para no superponer dialogs
  setTimeout(() => {
    void requestHeadsUpPermission().catch((err) =>
      pushBreadcrumb('heads-up dialog failed', { error: toMessage(err) }),
    );
  }, 2000);

  return fcmToken;
}

// Muestra un banner sencillo cuando llega la notificación
export function setForegroundNotificationHandler() {
  // Política de primer plano, igual en las dos plataformas:
  //   visual  → lo dibuja la app (toast de sonner-native / AlarmScreen), NO el sistema.
  //             Poner shouldShowBanner en true daría banner del sistema *encima* del
  //             toast: UI duplicada, no un arreglo.
  //   sonido  → lo pide el sistema, y solo para alertas críticas.
  //
  // Por qué el sonido va aparte: en Android el canal (IMPORTANCE_MAX) suena aunque el
  // handler diga que no — por eso nunca se notó. iOS obedece el handler al pie de la
  // letra, así que con todo en false una alerta nivel 4 llegaba **muda** mientras la
  // app estaba abierta. El `sound: "default"` que manda el backend (build_apns_config)
  // no sirve de nada si el handler se niega a reproducirlo.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      const isCritical =
        data?.fullScreen === "true" ||
        data?.category === "sos" ||
        Number(data?.level ?? data?.siat_level ?? data?.alertLevel ?? 0) >= 4;

      return {
        shouldPlaySound: isCritical,
        shouldShowAlert: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    },
  });

  Notifications.addNotificationReceivedListener((notif) => {
    const { title, body } = notif.request.content;
    const data = notif.request.content.data;

    if (data?.type === "contacts_refresh") {
      console.log('[QA_NOTIF] silent push contacts_refresh → emitting DeviceEventEmitter');
      DeviceEventEmitter.emit('contacts:refresh');
      return;
    }

    if (data?.category === "sos" || data?.category === "sos_invite" || data?.category === "sos_rejected" || data?.category === "sos_contact_added") {
      console.log('[QA_NOTIF] skip toast for', data.category, '— handled by _layout.tsx');
      return;
    }

    const levelNum = Number(data?.level ?? data?.siat_level ?? data?.alertLevel ?? 0);
    if (levelNum >= 2) {
      console.log('[QA_NOTIF] foreground system banner enabled | title:', title ?? 'none', '| alertId:', data?.alertId ?? 'none');
      return;
    }

    console.log('[QA_NOTIF] foreground toast | title:', title ?? 'none', '| alertId:', data?.alertId ?? 'none');
    toast(title ?? '', { description: body ?? undefined });
    track("push_received_foreground", {
      alertId: data?.alertId ? String(data.alertId) : undefined,
    });
  });
}

// Devuelve el unsubscribe para limpiarlo en unuseEffect
export function addNotificationResponseListener(
  onTap: (
    data: Record<string, unknown>,
    content: { title?: string | null; body?: string | null },
  ) => void,
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const { data, title, body } = response.notification.request.content;
    onTap(data, { title, body });
  });
}
