import "../global.css";
import { clearOnboardingData } from "./onboarding/_services/onboardingService";
import { resetAllTours } from "../features/tour/tourService";
import {
  Alert,
  Linking,
  Platform,
  Text,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useModel } from "./ai/_context/ModelContext";
import { MODEL_FAILURE_LABEL } from "./ai/_services/modelTelemetry";
import { useAuth } from "../features/auth/AuthContext";
import ScreenHeader from "../components/ScreenHeader";
import OptionCard from "../components/OptionCard";

/**
 * Must stay identical to the Privacy Policy URL filed in App Store Connect.
 * App Review opens both and compares them, and a link that 404s from inside the
 * app is a metadata rejection — so if the marketing site ever moves this page,
 * this constant moves with it.
 */
const PRIVACY_POLICY_URL = "https://www.bluai.com.mx/aviso-de-privacidad";

export default function SettingsScreen() {
  const router = useRouter();
  const {
    modelStatus,
    optIn,
    optOut,
    retryDownload,
    downloadProgress,
    modelFailure,
  } = useModel();
  const { signOut, deleteAccount } = useAuth();

  const handleDeleteAccount = () => {
    Alert.alert(
      "Eliminar cuenta",
      "¿Estás seguro? Esta acción es permanente y no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccount();
            } catch {
              Alert.alert(
                "Error",
                "No se pudo eliminar la cuenta. Intenta de nuevo.",
              );
              return;
            }
            try {
              await clearOnboardingData();
              await resetAllTours();
            } catch (e) {
              console.warn("[Bluai] Local cleanup after delete failed", e);
            }
          },
        },
      ],
    );
  };

  const handleSignOut = () => {
    Alert.alert("Cerrar sesión", "¿Estás seguro que deseas cerrar sesión?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", style: "destructive", onPress: signOut },
    ]);
  };

  const handleResetOnboarding = async () => {
    Alert.alert(
      "Reiniciar Onboarding",
      "¿Estás seguro? Esto borrará tus datos y mostrará el wizard de nuevo.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Reiniciar",
          style: "destructive",
          onPress: async () => {
            await clearOnboardingData();
            router.replace("/onboarding/step1");
          },
        },
      ],
    );
  };

  const handleReplayTutorial = async () => {
    try {
      await resetAllTours();
      // replace, not push: the map has to *gain focus* for `useTourGate` to
      // re-evaluate, and leaving Ajustes on the stack would just let the user
      // walk back into a screen whose flags no longer match what they saw.
      router.replace("/(tabs)/MapScreen");
    } catch {
      Alert.alert(
        "Error",
        "No se pudo reiniciar el tutorial. Intenta de nuevo.",
      );
    }
  };

  const handleOpenPrivacyPolicy = async () => {
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch {
      // openURL rejects when no handler can take the URL (no browser, or the
      // scheme is blocked). Say where to find it rather than failing silently —
      // a tap that does nothing reads as a broken app to a reviewer.
      Alert.alert(
        "No se pudo abrir el enlace",
        "Consulta el aviso de privacidad en bluai.com.mx/aviso-de-privacidad",
      );
    }
  };

  const handleDownloadModel = () => {
    Alert.alert(
      "Descargar modelo IA",
      "El modelo se descargará en segundo plano. Puedes seguir usando la app mientras tanto.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Descargar", onPress: optIn },
      ],
    );
  };

  const handleDeleteModel = () => {
    Alert.alert(
      "Eliminar modelo IA",
      "¿Estás seguro? Tendrás que descargarlo de nuevo para usar el modo sin conexión.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: optOut },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Ajustes" />

      <ScrollView className="flex-1 pt-6" showsVerticalScrollIndicator={false}>
        <OptionCard
          icon="bell-outline"
          title="Notificaciones"
          onPress={() => router.push("/NotificationPreferencesScreen")}
        />

        <OptionCard
          icon="restore"
          title="Reiniciar Onboarding"
          onPress={handleResetOnboarding}
        />

        {/* AI offline model — one card per lifecycle status (single source of truth).
            Android only this release: the executorch runtime does initialise on iOS
            (it ships in the binary and the May 2026 iOS builds ran fine with it), but
            the download → load → inference path has never been exercised there. Hiding
            the entry point is what keeps that path unreachable, so an iOS user can't
            pull a ~1 GB model we've never seen run. Remove this gate when iOS parity
            ships — nothing else here is platform-specific. */}
        {Platform.OS !== "ios" && (
          <>
            {modelStatus === "idle" && (
              <OptionCard
                icon="chip"
                title="Instalar asistente de IA sin conexión"
                onPress={handleDownloadModel}
              />
            )}

            {modelStatus === "checking" && (
              <OptionCard
                icon="cloud-download-outline"
                title="Preparando descarga..."
                rightElement={<ActivityIndicator color="white" />}
              />
            )}

            {modelStatus === "downloading" && (
              <OptionCard
                icon="cloud-download-outline"
                title="Descargando modelo IA..."
                rightElement={
                  <Text style={{ color: "white", fontWeight: "600" }}>
                    {Math.round(downloadProgress * 100)}%
                  </Text>
                }
              />
            )}

            {modelStatus === "reconnecting" && (
              <OptionCard
                icon="autorenew"
                title="Reconectando..."
                subtitle="Conexión interrumpida — reanudando la descarga"
                rightElement={
                  <Text style={{ color: "white", fontWeight: "600" }}>
                    {Math.round(downloadProgress * 100)}%
                  </Text>
                }
              />
            )}

            {modelStatus === "loading" && (
              <OptionCard
                icon="cog-sync-outline"
                title="Cargando modelo en memoria..."
                rightElement={<ActivityIndicator color="white" />}
              />
            )}

            {modelStatus === "failed" && modelFailure && (
              <OptionCard
                icon="alert-circle-outline"
                title={`${MODEL_FAILURE_LABEL[modelFailure.type]} — reintentar`}
                subtitle={modelFailure.message}
                onPress={retryDownload}
                danger
              />
            )}

            {modelStatus === "ready" && (
              <OptionCard
                icon="check-circle-outline"
                title="Modelo IA listo"
                onPress={handleDeleteModel}
                rightElement={
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    color="#EF4444"
                    size={22}
                  />
                }
              />
            )}
          </>
        )}

        <OptionCard
          icon="school-outline"
          title="Como funciona Bluai"
          subtitle="Repite el tutorial de la app"
          onPress={handleReplayTutorial}
        />

        <OptionCard
          icon="shield-lock-outline"
          title="Aviso de privacidad"
          subtitle="Cómo tratamos y protegemos tus datos"
          onPress={handleOpenPrivacyPolicy}
        />

        <OptionCard
          icon="logout"
          title="Cerrar sesión"
          onPress={handleSignOut}
          danger
        />
        <OptionCard
          icon="account-remove-outline"
          title="Eliminar cuenta"
          onPress={handleDeleteAccount}
          danger
        />
      </ScrollView>
    </SafeAreaView>
  );
}
