import "../../global.css";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, Pressable, StyleSheet, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, fonts } from "../../utils/theme";

export default function SOSReceiverScreen() {
  const router = useRouter();
  const { senderName, senderPhone, lat, lon } = useLocalSearchParams<{
    senderName: string;
    senderPhone?: string;
    lat?: string;
    lon?: string;
  }>();

  const parsedLat = parseFloat(lat ?? "");
  const parsedLon = parseFloat(lon ?? "");
  const hasCoords = Number.isFinite(parsedLat) && Number.isFinite(parsedLon);
  const hasPhone  = !!senderPhone && senderPhone.trim().length > 0;

  console.log('[QA_SOS_RECEIVER] render | hasCoords:', hasCoords, '| hasPhone:', hasPhone); // sender name/phone/GPS deliberately not logged — PII

  function handleCall() {
    const tel = `tel:${senderPhone!.replace(/\s/g, "")}`;
    Linking.canOpenURL(tel).then((can) => {
      if (can) Linking.openURL(tel);
      else Alert.alert("Error", "No se puede abrir la marcadora en este dispositivo.");
    });
  }

  function handleViewOnMap() {
    console.log('[QA_SOS_RECEIVER] ver en mapa'); // GPS deliberately not logged — PII
    router.push({
      pathname: "/(tabs)/MapScreen",
      params: hasCoords
        ? { alertLat: String(parsedLat), alertLon: String(parsedLon), alertTitle: senderName, alertSosPhone: senderPhone ?? '' }
        : {},
    });
  }

  function handleDismiss() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/MapScreen");
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      {/* Header urgency bar */}
      <View style={s.urgencyBar}>
        <MaterialCommunityIcons name="alarm-light" size={20} color="#030810" />
        <Text style={s.urgencyText}>ALERTA SOS</Text>
        <MaterialCommunityIcons name="alarm-light" size={20} color="#030810" />
      </View>

      {/* Main content */}
      <View style={s.body}>
        {/* Icon */}
        <View style={s.iconWrap}>
          <MaterialCommunityIcons name="alarm-light-outline" size={64} color={colors.brandRed} />
        </View>

        {/* Sender */}
        <Text style={s.label}>Tu contacto</Text>
        <Text style={s.senderName}>{senderName ?? "Un contacto"}</Text>
        <Text style={s.subtitle}>Necesita ayuda urgente</Text>

        {/* Actions */}
        <View style={s.actions}>
          {hasPhone && (
            <Pressable style={s.callBtn} onPress={handleCall} android_ripple={{ color: "rgba(0,0,0,0.15)" }}>
              <MaterialCommunityIcons name="phone" size={22} color="#030810" />
              <Text style={s.callBtnText}>Llamar</Text>
            </Pressable>
          )}

          {hasCoords && (
            <Pressable style={s.mapBtn} onPress={handleViewOnMap} android_ripple={{ color: "rgba(255,255,255,0.08)" }}>
              <MaterialCommunityIcons name="map-search-outline" size={22} color={colors.brandCyan} />
              <Text style={s.mapBtnText}>Ver ubicación en mapa</Text>
            </Pressable>
          )}

          {!hasCoords && (
            <View style={s.noLocationCard}>
              <MaterialCommunityIcons name="map-marker-off-outline" size={20} color="rgba(255,255,255,0.35)" />
              <Text style={s.noLocationText}>Sin ubicación disponible</Text>
            </View>
          )}
        </View>
      </View>

      {/* Dismiss */}
      <Pressable style={s.dismissBtn} onPress={handleDismiss} android_ripple={{ color: "rgba(255,255,255,0.06)" }}>
        <Text style={s.dismissText}>Cerrar</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07111E",
  },
  urgencyBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brandRed,
    paddingVertical: 10,
  },
  urgencyText: {
    color: "#030810",
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 14,
    letterSpacing: 2,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(226,67,55,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(226,67,55,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  label: {
    color: "rgba(255,255,255,0.45)",
    fontFamily: fonts.poppins,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  senderName: {
    color: "white",
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 26,
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: fonts.poppins,
    fontSize: 15,
    marginBottom: 36,
  },
  actions: {
    alignSelf: "stretch",
    gap: 12,
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brandRed,
    borderRadius: 14,
    paddingVertical: 16,
  },
  callBtnText: {
    color: "#030810",
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 17,
  },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.brandCyan,
    borderRadius: 14,
    paddingVertical: 14,
  },
  mapBtnText: {
    color: colors.brandCyan,
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 16,
  },
  noLocationCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  noLocationText: {
    color: "rgba(255,255,255,0.35)",
    fontFamily: fonts.poppins,
    fontSize: 14,
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  dismissText: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: fonts.poppins,
    fontSize: 15,
  },
});
