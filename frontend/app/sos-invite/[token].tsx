import "../../global.css";
import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authFetch } from "../../utils/api";
import { API_BASE_URL } from "../../utils/config";
import { colors, fonts } from "../../utils/theme";
import { redactToken } from "../../utils/pushTelemetry";

type Stage = "loading" | "preview" | "accepting" | "rejecting" | "success" | "error";

interface Preview {
  inviter_display_name: string;
  contact_name: string;
  expires_at: string;
}

export const PENDING_SOS_INVITE_KEY = "@BluEye:pending_sos_invite";

export default function SosInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [stage, setStage]       = useState<Stage>("loading");
  const [preview, setPreview]   = useState<Preview | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    console.log('[QA_SOS_INVITE] screen mount | tokenPrefix:', token ? redactToken(token) : 'MISSING');
    if (!token) {
      console.warn('[QA_SOS_INVITE] no token → error stage');
      setStage("error"); setErrorMsg("Enlace inválido."); return;
    }
    // Persist unconditionally on arrival — not just for the push-notification path
    // (_layout.tsx). A manually-shared link can land here before the user is
    // logged in; without this, the token has nowhere else it gets saved and the
    // invite is lost the moment they navigate away to sign in.
    AsyncStorage.setItem(PENDING_SOS_INVITE_KEY, token).catch(() => {});
    const url = `${API_BASE_URL}/api/v1/sos-invitations/preview/${token}`;
    console.log('[QA_SOS_INVITE] fetching preview'); // full URL deliberately not logged — embeds the token
    fetch(url)
      .then(r => {
        console.log('[QA_SOS_INVITE] preview response | status:', r.status);
        if (r.status === 404) return Promise.reject("not_found");
        if (r.status === 410) return Promise.reject("expired");
        if (r.status === 409) return Promise.reject("already_used");
        if (!r.ok) return Promise.reject("unknown");
        return r.json();
      })
      .then((data: Preview) => {
        console.log('[QA_SOS_INVITE] preview OK'); // inviter/contact names deliberately not logged — PII
        setPreview(data); setStage("preview");
      })
      .catch((reason: string) => {
        console.warn('[QA_SOS_INVITE] preview failed | reason:', reason);
        AsyncStorage.removeItem(PENDING_SOS_INVITE_KEY).catch(() => {});
        setStage("error");
        setErrorMsg(
          reason === "expired"      ? "Este enlace expiró. Pídele a quien te invitó que genere uno nuevo." :
          reason === "already_used" ? "Esta invitación ya fue aceptada anteriormente." :
          reason === "not_found"    ? "Este enlace no existe o ya no es válido." :
          "No se pudo cargar la invitación. Comprueba tu conexión."
        );
      });
  }, [token]);

  async function handleReject() {
    if (!token) return;
    console.log('[QA_SOS_INVITE] rejecting | tokenPrefix:', redactToken(token));
    setStage("rejecting");
    try {
      await authFetch(`${API_BASE_URL}/api/v1/sos-invitations/${token}/reject`, { method: "POST" });
      console.log('[QA_SOS_INVITE] rejected OK');
    } catch (e) {
      console.warn('[QA_SOS_INVITE] reject error (non-critical):', e);
    } finally {
      await AsyncStorage.removeItem(PENDING_SOS_INVITE_KEY).catch(() => {});
      router.back();
    }
  }

  async function handleAccept() {
    if (!token) return;
    console.log('[QA_SOS_INVITE] accepting | tokenPrefix:', redactToken(token));
    setStage("accepting");
    try {
      const res = await authFetch(`${API_BASE_URL}/api/v1/sos-invitations/${token}/accept`, { method: "POST" });
      console.log('[QA_SOS_INVITE] accept response | status:', res.status);
      if (res.status === 409) { setStage("error"); setErrorMsg("Esta invitación ya fue aceptada."); return; }
      if (res.status === 410) { setStage("error"); setErrorMsg("Este enlace expiró."); return; }
      if (res.status === 400) { setStage("error"); setErrorMsg("No puedes aceptar tu propia invitación."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await AsyncStorage.removeItem(PENDING_SOS_INVITE_KEY);
      console.log('[QA_SOS_INVITE] accepted OK → cleared pending token');
      setStage("success");
    } catch (e) {
      console.error('[QA_SOS_INVITE] accept error:', e);
      setStage("error");
      setErrorMsg("No se pudo procesar la invitación. Comprueba tu conexión e inicia sesión.");
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <View style={s.centered}>
        <View style={s.card}>

          {(stage === "loading" || stage === "accepting" || stage === "rejecting") && (
            <ActivityIndicator size="large" color={colors.brandCyan} />
          )}

          {stage === "preview" && preview && (
            <>
              <MaterialCommunityIcons name="shield-account-outline" size={52} color={colors.brandCyan} />
              <Text style={s.title}>Invitación SOS</Text>
              <Text style={s.body}>
                <Text style={s.highlight}>{preview.inviter_display_name}</Text>
                {" quiere agregarte como contacto SOS de emergencia.\nRecibirás su alerta si necesita ayuda urgente."}
              </Text>
              <Text style={s.sub}>Contacto guardado: {preview.contact_name}</Text>
              <View style={s.row}>
                <TouchableOpacity style={s.cancelBtn} onPress={handleReject}>
                  <Text style={s.cancelTxt}>Rechazar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.acceptBtn} onPress={handleAccept}>
                  <Text style={s.acceptTxt}>Aceptar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {stage === "success" && preview && (
            <>
              <MaterialCommunityIcons name="check-circle-outline" size={52} color={colors.brandGreen} />
              <Text style={s.title}>¡Listo!</Text>
              <Text style={s.body}>
                Ahora eres contacto SOS de{" "}
                <Text style={s.highlight}>{preview.inviter_display_name}</Text>.
                {"\nTe avisarán si necesitan ayuda urgente."}
              </Text>
              <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
                <Text style={s.closeTxt}>Cerrar</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === "error" && (
            <>
              <MaterialCommunityIcons name="alert-circle-outline" size={52} color={colors.brandRed} />
              <Text style={s.title}>No disponible</Text>
              <Text style={[s.body, { textAlign: "center" }]}>{errorMsg}</Text>
              <TouchableOpacity style={[s.cancelBtn, { marginTop: 20, borderColor: colors.brandCyan }]} onPress={() => router.back()}>
                <Text style={[s.cancelTxt, { color: colors.brandCyan }]}>Cerrar</Text>
              </TouchableOpacity>
            </>
          )}

        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  card:     { backgroundColor: "rgba(10,28,50,0.6)", borderRadius: 20, borderWidth: 1,
              borderColor: "rgba(255,255,255,0.1)", padding: 28, width: "100%", alignItems: "center" },
  title:    { color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 20, marginTop: 14, marginBottom: 10 },
  body:     { color: "rgba(255,255,255,0.7)", fontFamily: fonts.poppins, fontSize: 14, lineHeight: 22, textAlign: "center" },
  highlight:{ color: "white", fontFamily: fonts.poppinsSemiBold },
  sub:      { color: colors.brandCyan, fontFamily: fonts.poppins, fontSize: 12, marginTop: 10 },
  row:      { flexDirection: "row", gap: 12, marginTop: 24, width: "100%" },
  cancelBtn:{ flex: 1, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.55)",
              backgroundColor: "rgba(255,255,255,0.07)",
              borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelTxt:{ color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
  acceptBtn:{ flex: 1, backgroundColor: colors.brandCyan, borderRadius: 12,
              paddingVertical: 14, alignItems: "center" },
  acceptTxt:{ color: "#030810", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
  closeBtn: { width: "100%", backgroundColor: colors.brandCyan, borderRadius: 12,
              paddingVertical: 14, alignItems: "center", marginTop: 20 },
  closeTxt: { color: "#030810", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
});
