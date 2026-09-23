import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { ModelProvider } from './ai/_context/ModelContext';
import { AuthProvider, useAuth } from '../features/auth/AuthContext';
import { NetworkProvider } from '../features/network/NetworkContext';
// import { Drawer } from "expo-router/drawer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../context/ThemeContext";
import { DaltonicModeProvider } from "../context/DaltonicModeContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { LinearGradient } from "expo-linear-gradient";
import { gradients } from "../utils/theme";
import React, { useEffect } from "react";
import { useFonts } from "expo-font";
import { Alert, AppState, DeviceEventEmitter, Platform, StatusBar as RNStatusBar } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  registerForPushNotificationsAsync,
  sendTokenToBackend,
  setForegroundNotificationHandler,
  addNotificationResponseListener,
  subscribeToTokenRefresh,
} from "../utils/pushNotifications";
import {
  pushBreadcrumb,
  redactToken,
  reportPushFailure,
  toMessage,
} from "../utils/pushTelemetry";
import * as Notifications from "expo-notifications";
import { Toaster, toast } from "sonner-native";
import { initAnalytics, track, flush } from "../utils/analytics"
import { flushSOSQueue, shouldConfirmPendingSOS } from "./map/sosQueue"
import { PENDING_SOS_INVITE_KEY } from "./sos-invite/[token]";
export const PENDING_SOS_CONTACT_ADDED_KEY = "@BluEye:pending_sos_contact_added";
import { hasCompletedOnboarding } from "./onboarding/_services/onboardingService"
import { syncProfileIfPending } from "../utils/profileSync"
import { authFetch } from "../utils/api"
import { API_BASE_URL } from "../utils/config"
import { usePathname } from "expo-router";
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

if (Platform.OS !== "web") {
  const { initExecutorch } = require("react-native-executorch");
  const { ExpoResourceFetcher } = require("react-native-executorch-expo-resource-fetcher");
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
}
const DEV_BYPASS_AUTH = process.env.EXPO_PUBLIC_DEV_BYPASS_AUTH === 'true'

interface NotificationData {
  alertId?: string
  alert_id?: string
  alertLevel?: string
  level?: string
  siat_level?: string
  siat_color?: string
  fullScreen?: string
  category?: string
  alertTitle?: string
  alertMessage?: string
  bulletinUrl?: string
  sender_name?: string
  sender_phone?: string
  lat?: string
  lon?: string
  invite_token?: string
  inviter_display_name?: string
  adder_display_name?: string
  type?: string
}

function resolveNotifPayload(
  data: NotificationData,
  content?: { title?: string | null; body?: string | null }
) {
  const id = data.alertId || data.alert_id
  const levelNum = Number(data.level ?? data.siat_level ?? data.alertLevel ?? 0)
  const isFullScreen = data.fullScreen === 'true' || levelNum >= 4
  const isSos = data.category === 'sos'
  const isSosInvite = data.category === 'sos_invite'
  const isSosRejected = data.category === 'sos_rejected'
  const isSosContactAdded = data.category === 'sos_contact_added'
  const adderDisplayName = data.adder_display_name ?? 'Tu contacto'
  const sosLat = parseFloat(data.lat ?? '')
  const sosLon = parseFloat(data.lon ?? '')
  const sosHasCoords = Number.isFinite(sosLat) && Number.isFinite(sosLon)
  const senderPhone = data.sender_phone ?? ''
  return {
    id,
    levelNum,
    isFullScreen,
    isSos,
    isSosInvite,
    isSosRejected,
    isSosContactAdded,
    adderDisplayName,
    inviteToken: data.invite_token,
    inviterDisplayName: data.inviter_display_name ?? 'Un usuario',
    senderName: data.sender_name ?? 'Un contacto',
    senderPhone,
    sosLat,
    sosLon,
    sosHasCoords,
    params: {
      alertId: id,
      category: data.category ?? String(levelNum),
      title: data.alertTitle ?? content?.title ?? "Alerta de emergencia",
      message: data.alertMessage ?? content?.body ?? "Siga las indicaciones de las autoridades.",
      bulletinUrl: data.bulletinUrl,
    },
  }
}

function AuthGate({ children }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const segments = useSegments()
  const authEnabled = !DEV_BYPASS_AUTH

  useEffect(() => {
    if (!authEnabled || !user) return
    // Reconciliación del perfil del onboarding. Corre una vez por arranque autenticado
    syncProfileIfPending()
    registerForPushNotificationsAsync()
      .then((token) => pushBreadcrumb("registration finished", { tokenPrefix: redactToken(token) }))
      // Backstop: every stage inside is individually guarded, so anything
      // reaching here is genuinely unforeseen — which is exactly why it must
      // not land in a console line nobody reads.
      .catch((err) => reportPushFailure(
        { type: "unknown", message: toMessage(err), phase: "unknown" },
        { hasUid: !!user?.uid },
      ))
    // Rotación de token. La API correcta depende de la plataforma porque el valor
    // que emite cada una es distinto — ver subscribeToTokenRefresh().
    const unsubscribeTokenRefresh = subscribeToTokenRefresh((token) => {
      sendTokenToBackend(token).catch((err) => reportPushFailure(
        { type: "unknown", message: toMessage(err), phase: "token" },
        { hasUid: !!user?.uid, tokenPrefix: redactToken(token) },
      ))
    })
    return () => unsubscribeTokenRefresh()
  }, [authEnabled, user?.uid])

  useEffect(() => {
    if (loading) return
    if (!authEnabled) {
      // Bypass mode: if user just logged in from auth screen, send them to tabs
      if (user && segments[0] === '(auth)') {
        router.replace('/(tabs)/MapScreen')
      }
      return
    }
    const inAuthGroup = segments[0] === '(auth)'
    // sos-invite previews are public (GET /sos-invitations/preview/{token} needs no
    // auth) — someone tapping a manually-shared invite link often isn't logged in
    // yet. Bouncing them to /(auth) here drops the token with nowhere to resume
    // from, silently losing the invite. Let the screen itself gate the "Aceptar"
    // action behind login instead.
    const isSosInviteRoute = segments[0] === 'sos-invite'
    if (!user && !inAuthGroup && !isSosInviteRoute) {
      router.replace('/(auth)')
    } else if (user && inAuthGroup) {
      const checkAndRoute = async () => {
        const completed = await hasCompletedOnboarding()
        if (completed) {
          router.replace('/(tabs)/MapScreen')
          return
        }
        // AsyncStorage vacío (e.g. reinstalación): verificar backend como fuente de verdad
        try {
          const res = await authFetch(`${API_BASE_URL}/api/v1/users/me`, { method: 'POST' })
          if (res.ok) {
            const profile = await res.json()
            if (profile?.display_name) {
              await AsyncStorage.setItem('@blueye_onboarding_completed', 'true')
              router.replace('/(tabs)/MapScreen')
              return
            }
          }
        } catch { /* si falla, continúa a onboarding */ }
        router.replace('/onboarding/step1')
      }
      checkAndRoute()
    }
  }, [authEnabled, user, loading, segments])

  return children
}

/* ---------- Layout raíz ---------- */
export default Sentry.wrap(function Layout() {
  const router = useRouter();
  const alarmActiveRef = React.useRef(false);

  const [fontsLoaded] = useFonts({
    'Square721': require('../assets/fonts/square-721-bold-extended-bt.ttf'),
    'Poppins-Light': require('../assets/fonts/Poppins-Light.otf'),
    'Poppins-SemiBold': require('../assets/fonts/Poppins-SemiBold.otf'),
  });

  useEffect(() => {
    initAnalytics().catch(console.error);
  }, []);

  // Configure StatusBar to not be translucent (backup for native API)
  useEffect(() => {
    RNStatusBar.setTranslucent(false);
  }, []);

  useEffect(() => {
    setForegroundNotificationHandler();

    // Tap en notificación (background → foreground, o foreground tap)
    const tapSub = addNotificationResponseListener(async (rawData, content) => {
      const data = rawData as NotificationData
      const { id, isFullScreen, isSos, isSosInvite, isSosRejected, isSosContactAdded, inviteToken, senderName, senderPhone, sosLat, sosLon, sosHasCoords, params } = resolveNotifPayload(data, content)
      console.log('[QA_NOTIF] tap | alertId:', id ?? 'none', '| fullScreen:', isFullScreen, '| sos:', isSos, '| sosInvite:', isSosInvite, '| sosRejected:', isSosRejected, '| contactAdded:', isSosContactAdded)

      if (data.type === 'contacts_refresh') {
        console.log('[QA_NOTIF] tap contacts_refresh → skip navigation');
        return;
      }

      await initAnalytics();
      track("push_open", {
        alertId: id ? String(id) : undefined,
        alertLevel: isSos || isSosInvite ? undefined : (params.category ? Number(params.category) : undefined),
        fullScreen: isFullScreen,
        origin: "listener",
      });

      if (isSosInvite && inviteToken) {
        console.log('[QA_NAV] tap → sos-invite | tokenPrefix:', redactToken(inviteToken))
        AsyncStorage.setItem(PENDING_SOS_INVITE_KEY, inviteToken).catch(() => {});
        router.push({ pathname: "/sos-invite/[token]", params: { token: inviteToken } });
        return;
      }
      if (isSos) {
        console.log('[QA_NAV] tap → sos-receiver | sender:', senderName, '| hasCoords:', sosHasCoords, '| hasPhone:', !!senderPhone)
        router.push({
          pathname: '/sos-receiver',
          params: {
            senderName,
            senderPhone,
            lat: sosHasCoords ? String(sosLat) : '',
            lon: sosHasCoords ? String(sosLon) : '',
          },
        });
        return;
      }
      if (isSosRejected) {
        console.log('[QA_NAV] tap → SOSContactsScreen (rejected)')
        router.push('/SOSContactsScreen');
        return;
      }
      if (isSosContactAdded) {
        console.log('[QA_NAV] tap → SOSContactsScreen (contact added)')
        router.push('/SOSContactsScreen');
        return;
      }
      if (isFullScreen) {
        console.log('[QA_NAV] tap → AlarmScreen | alertId:', id ?? 'none', '| category:', params.category)
        router.push({ pathname: "AlarmScreen", params });
      } else if (id) {
        console.log('[QA_NAV] tap → alert detail | alertId:', id)
        router.push({ pathname: "/alerts/[id]", params: { id } });
      } else {
        // No useful payload — MIUI/Android can fire the response listener spuriously
        // when bringing the app to foreground. Don't navigate anywhere.
        console.log('[QA_NAV] tap → no useful data, skipping navigation');
      }
    });

    // Notificación recibida mientras la app está abierta → AlarmScreen si nivel >= 4
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const rawData = notification.request.content.data as NotificationData
      const content = notification.request.content
      const { isFullScreen, isSos, isSosInvite, isSosRejected, isSosContactAdded, inviteToken, inviterDisplayName, senderName, senderPhone, adderDisplayName, params } = resolveNotifPayload(rawData, content)
      console.log('[QA_NOTIF] received foreground | fullScreen:', isFullScreen, '| sos:', isSos, '| sosInvite:', isSosInvite, '| sosRejected:', isSosRejected, '| contactAdded:', isSosContactAdded, '| category:', params.category)
      if (isFullScreen && !alarmActiveRef.current) {
        alarmActiveRef.current = true
        console.log('[QA_NAV] received → AlarmScreen | category:', params.category, '| alertId:', params.alertId ?? 'none')
        router.push({ pathname: "AlarmScreen", params })
        // Liberar el guard después de un debounce para cubrir multi-push
        setTimeout(() => { alarmActiveRef.current = false }, 5000)
        return;
      }
      if (isSosInvite && inviteToken) {
        console.log('[QA_SOS_INVITE] foreground received | saving tokenPrefix:', redactToken(inviteToken))
        AsyncStorage.setItem(PENDING_SOS_INVITE_KEY, inviteToken).catch(() => {});
        toast(`Invitación SOS de ${inviterDisplayName}`, {
          description: 'Toca para aceptar la invitación.',
          action: {
            label: 'Ver',
            onClick: () => router.push({ pathname: "/sos-invite/[token]", params: { token: inviteToken } }),
          },
        });
        return;
      }
      if (isSos) {
        console.log('[QA_NAV] foreground SOS → sos-receiver | sender:', senderName, '| hasPhone:', !!senderPhone)
        router.push({
          pathname: '/sos-receiver',
          params: {
            senderName,
            senderPhone,
            lat: rawData.lat ?? '',
            lon: rawData.lon ?? '',
          },
        });
        // IMPORTANCE_MAX overrides shouldShowAlert:false on Android/MIUI, so the notification
        // stays visible in the tray even after we handle it in-app. Dismiss it immediately so
        // the tap listener can't fire again for the same SOS and push a second sos-receiver.
        Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
        return;
      }
      if (isSosRejected) {
        console.log('[QA_SOS_INVITE] foreground received | sos_rejected')
        toast(content.title ?? 'Invitación SOS rechazada', {
          description: content.body ?? undefined,
        });
        DeviceEventEmitter.emit('contacts:refresh');
        return;
      }
      if (isSosContactAdded) {
        console.log('[QA_SOS] foreground received | sos_contact_added | adder:', adderDisplayName)
        AsyncStorage.setItem(PENDING_SOS_CONTACT_ADDED_KEY, adderDisplayName).catch(() => {});
        toast(`${adderDisplayName} te agregó como contacto SOS`, {
          description: 'Ya son contactos mutuos.',
          action: {
            label: 'Ver',
            onClick: () => router.push('/SOSContactsScreen'),
          },
        });
        DeviceEventEmitter.emit('contacts:refresh');
      }
    });

    return () => {
      tapSub.remove();
      receivedSub.remove();
    };
  }, []);

  // App abierta tocando una notificación desde cold start
  useEffect(() => {
    (async () => {
      const initial = await Notifications.getLastNotificationResponseAsync();
      if (!initial) return;

      // Deduplicate: skip if this notification was already handled (prevents stale
      // notifications from being re-processed on hot reload or subsequent app mounts)
      const notifId = initial.notification.request.identifier;
      const LAST_COLD_KEY = '@BluEye:last_cold_start_notif';
      try {
        const lastProcessed = await AsyncStorage.getItem(LAST_COLD_KEY);
        if (lastProcessed === notifId) return;
        await AsyncStorage.setItem(LAST_COLD_KEY, notifId);
      } catch { /* AsyncStorage unavailable — proceed */ }

      const data = initial.notification.request.content.data as NotificationData | undefined
      if (!data) return
      const { title: coldTitle, body: coldBody } = initial.notification.request.content

      const { id, isFullScreen, isSos, isSosInvite, isSosRejected, isSosContactAdded, adderDisplayName, inviteToken, senderName, senderPhone, sosLat, sosLon, sosHasCoords, params } = resolveNotifPayload(data, { title: coldTitle, body: coldBody })
      console.log('[QA_NAV] cold start | category:', data.category ?? 'none', '| type:', data.type ?? 'none', '| isSosInvite:', isSosInvite, '| isSos:', isSos, '| isSosRejected:', isSosRejected, '| contactAdded:', isSosContactAdded, '| id:', id ?? 'none')
      if (data.type === 'contacts_refresh') return
      if (!id && !isFullScreen && !isSos && !isSosInvite && !isSosRejected && !isSosContactAdded) return

      await initAnalytics();
      track("push_open", {
        alertId: id ? String(id) : undefined,
        alertLevel: isSos || isSosInvite ? undefined : (params.category ? Number(params.category) : undefined),
        fullScreen: isFullScreen,
        origin: "initial",
      });

      if (isSosInvite && inviteToken) {
        console.log('[QA_NAV] cold start → sos-invite | tokenPrefix:', redactToken(inviteToken))
        AsyncStorage.setItem(PENDING_SOS_INVITE_KEY, inviteToken).catch(() => {});
        router.push({ pathname: "/sos-invite/[token]", params: { token: inviteToken } });
        return;
      }
      if (isSos) {
        console.log('[QA_NAV] cold start → sos-receiver | sender:', senderName, '| hasCoords:', sosHasCoords, '| hasPhone:', !!senderPhone)
        router.push({
          pathname: '/sos-receiver',
          params: {
            senderName,
            senderPhone,
            lat: sosHasCoords ? String(sosLat) : '',
            lon: sosHasCoords ? String(sosLon) : '',
          },
        });
        return;
      }
      if (isSosRejected) {
        console.log('[QA_NAV] cold start → SOSContactsScreen (rejected)')
        router.push('/SOSContactsScreen');
        return;
      }
      if (isSosContactAdded) {
        console.log('[QA_NAV] cold start → SOSContactsScreen (contact added) | adder:', adderDisplayName)
        AsyncStorage.setItem(PENDING_SOS_CONTACT_ADDED_KEY, adderDisplayName).catch(() => {});
        router.push('/SOSContactsScreen');
        return;
      }
      if (isFullScreen) {
        router.push({ pathname: "AlarmScreen", params });
      } else if (id) {
        router.push({ pathname: "/alerts/[id]", params: { id } });
      }
    })();
  }, []);

  // Registra la pantalla actual en Mixpanel
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) {
      (async () => {
        await initAnalytics();
        track("screen_view", { screen: pathname });
      })();
    }
  }, [pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        track("app_background");
        flush();
      }
      if (state === "active") {
        shouldConfirmPendingSOS().then((needsConfirm) => {
          if (!needsConfirm) flushSOSQueue();
          // Si needsConfirm: MapScreen mostrará el Alert cuando el usuario vuelva al mapa.
        });
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" translucent={false} />
      <KeyboardProvider>
      <DaltonicModeProvider>
        <ThemeProvider>
          <SafeAreaProvider>
            <NetworkProvider>
            <AuthProvider>
              <AuthGate>
                <ModelProvider>
                  <LinearGradient
                    colors={gradients.primary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={{ flex: 1 }}
                  >
                  <Stack
                    screenOptions={{
                      headerTitleStyle: { fontWeight: "bold" },
                      contentStyle: { backgroundColor: "transparent" },
                    }}
                  >
                    <Stack.Screen
                      name="(auth)"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="(tabs)"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="onboarding"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="SettingsScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="NotificationPreferencesScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="SOSContactsScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="NotificationTestScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="sos-receiver/index"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="sos-invite/[token]"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="AlarmScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="FeedbackScreen"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="local-chat"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="alerts"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="educational"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="subscription"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="profile"
                      options={{ headerShown: false }}
                    />
                  </Stack>
                  <Toaster />
                  </LinearGradient>
                </ModelProvider>
              </AuthGate>
            </AuthProvider>
            </NetworkProvider>
          </SafeAreaProvider>
        </ThemeProvider>
      </DaltonicModeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
});
