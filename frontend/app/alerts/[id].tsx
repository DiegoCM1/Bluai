import { useEffect, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Linking,
  StyleSheet,
  ImageBackground
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import dayjs from "../../utils/date";
import { colorForLevel, labelForLevel } from "./_components/AlertCard";
import { track } from "../../utils/analytics";
import { authFetch } from '../../utils/api'
import { API_BASE_URL } from '../../utils/config'
import ScreenHeader from "../../components/ScreenHeader"
import { colors, fonts } from "../../utils/theme"
import { LinearGradient } from "expo-linear-gradient"

interface AlertData {
  id: string;
  level: number;
  title: string;
  short?: string;
  ai_summary?: string | null;
  timestamp: string;
  score?: number;
  recommendations?: string[];
  factors?: string[];
  pdf_url?: string;
  lat?: number | null;
  lon?: number | null;
}

function SectionPill({ title, color }: { title: string; color: string }) {
  return (
    <LinearGradient
      colors={[`${color}00`, color]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 10 }}
    >
      <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold, fontSize: 13, letterSpacing: 1 }}>
        {title}
      </Text>
    </LinearGradient>
  );
}

export default function AlertDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [alert, setAlert] = useState<AlertData | null>(null);
  const [loading, setLoad] = useState(true);
  const [error, setError] = useState<{ status?: number } | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleOpenBoletin = async () => {
    const url = alert?.pdf_url ?? "https://preparados.gob.mx/SIAT-CT/";
    console.log('[QA_LINK] boletin tap | alertId:', id, '| alertTitle:', alert?.title, '| url:', url);
    try {
      const canOpen = await Linking.canOpenURL(url);
      console.log('[QA_LINK] canOpenURL:', canOpen);
      if (canOpen) {
        await Linking.openURL(url);
        console.log('[QA_LINK] openURL called OK');
      }
    } catch (err) {
      console.error('[QA_LINK] openURL error:', err);
    }
  };

  useEffect(() => {
    let live = true;
    (async () => {
      const url = `${API_BASE_URL}/api/v1/alerts/${id}`
      try {
        const res = await authFetch(url);
        if (!res.ok) {
          const body = await res.text()
          console.error(`[AlertDetails] HTTP ${res.status} | id: ${id} | url: ${url} | body: ${body}`)
          throw Object.assign(new Error("Error"), { status: res.status });
        }
        const data = await res.json();
        if (live) {
          console.log('[QA_ALERTS] detail loaded | id:', id, '| level:', data.level, '| title:', data.title);
          setAlert(data);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isAuthError = msg === 'Not authenticated'
        console.error(`[AlertDetails] fetch failed | stage: ${isAuthError ? 'token' : 'request'} | id: ${id} | error: ${msg}`)
        if (live) setError(e as { status?: number });
      } finally {
        if (live) setLoad(false);
      }
    })();
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (alert) {
      track("alert_details_view", {
        alertId: String(alert.id),
        level: Number(alert.level),
        score: Number(alert.score ?? 0),
      });
    }
  }, [alert]);

  useEffect(() => {
    if (!alert) return
    // Already generated once at ingestion (SMN bulletins) — reuse it instead
    // of paying for another LLM call on every screen view.
    if (alert.ai_summary) {
      setAiSummary(alert.ai_summary)
      return
    }
    setAiLoading(true)
    let live = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    ;(async () => {
      try {
        const res = await authFetch(`${API_BASE_URL}/api/v1/ai/alert-summary`, {
          method: 'POST',
          body: JSON.stringify({ alert_id: alert.id }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (live) setAiSummary(data.summary)
      } catch {
        // falla silenciosamente — sección oculta
      } finally {
        clearTimeout(timeout)
        if (live) setAiLoading(false)
      }
    })()
    return () => {
      live = false
      controller.abort()
    }
  }, [alert]);

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-transparent">
        <ActivityIndicator size="large" color={colors.brandCyan} />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center bg-transparent">
        <Text style={{ color: 'white', fontFamily: fonts.poppins }}>
          {error.status === 404 ? "Alerta no encontrada" : "Error al cargar alerta"}
        </Text>
      </View>
    );
  }

  if (!alert) return null;

  const baseColor = colorForLevel(alert.level);
  const impactLabel = labelForLevel(alert.level);

  return (
    <ImageBackground source={require("../../assets/images/BACK-PANTALLA-INICIO.png")} resizeMode="cover" className="flex-1">

      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-transparent">
        <ScreenHeader title="Detalles de alerta" />

        {/* Timestamp */}
        <Text style={{ color: baseColor, fontFamily: fonts.poppins, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 12 }}>
          Ultima Actualización: {dayjs(alert.timestamp).format("DD/MM/YY - HH:mm")}
        </Text>

        {/* Hero card */}
        <View style={[styles.glassCard, { margin: 16, alignItems: 'center', paddingVertical: 28 }]}>
          <MaterialCommunityIcons name="weather-hurricane" size={52} color={baseColor} />
          <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold, fontSize: 28, textAlign: 'center', marginTop: 12 }}>
            {alert.title}
          </Text>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>

          {/* Metrics row */}
          <LinearGradient
            colors={[`${baseColor}00`, baseColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
          >
            <Text style={{ flex: 1, color: 'white', fontFamily: fonts.poppinsSemiBold, fontSize: 12, letterSpacing: 1 }}>
              {impactLabel.toUpperCase()}
            </Text>
            <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold, fontSize: 15 }}>
              Nivel {alert.level}
            </Text>
          </LinearGradient>

          {/* Description */}
          {alert.short && (
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.poppins, fontSize: 15, lineHeight: 22 }}>
              {alert.short}
            </Text>
          )}

          {/* AI Summary */}
          {(aiLoading || aiSummary) && (
            <View>
              <SectionPill title="RESUMEN IA:" color={baseColor} />
              {aiLoading ? (
                <View style={[styles.glassCard, { alignItems: 'center', paddingVertical: 20 }]}>
                  <ActivityIndicator size="small" color={colors.brandCyan} />
                </View>
              ) : aiSummary ? (
                <View style={styles.glassCard}>
                  <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: fonts.poppins, fontSize: 14, lineHeight: 22 }}>
                    {aiSummary}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Recommendations */}
          {alert.recommendations && alert.recommendations.length > 0 && (
            <View>
              <SectionPill title="RECOMENDACIONES:" color={baseColor} />
              <View style={styles.glassCard}>
                {alert.recommendations.map((r, i) => (
                  <Text key={i} style={{ color: 'white', fontFamily: fonts.poppins, fontSize: 14, marginBottom: i < alert.recommendations!.length - 1 ? 8 : 0 }}>
                    • {r}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {/* Factors */}
          {alert.factors && alert.factors.length > 0 && (
            <View>
              <SectionPill title="FACTORES:" color={baseColor} />
              <View style={styles.glassCard}>
                {alert.factors.map((f, i) => (
                  <Text key={i} style={{ color: 'white', fontFamily: fonts.poppins, fontSize: 14, marginBottom: i < alert.factors!.length - 1 ? 8 : 0 }}>
                    • {f}
                  </Text>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* CTAs */}
        <View className="px-4 pb-6 flex-row gap-3">
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: colors.brandBlue }]}
            activeOpacity={0.7}
            onPress={() => {
              console.log('[QA_NAV] alert detail → mapa | alertId:', alert.id, '| level:', alert.level, '| lat:', alert.lat, '| lon:', alert.lon);
              track("details_map_tap", { alertId: String(alert.id), level: Number(alert.level), score: Number(alert.score ?? 0) });
              const params: Record<string, string> = {
                alertTitle: alert.title,
                alertLevel: String(alert.level),
              };
              if (alert.lat != null) params.alertLat = String(alert.lat);
              if (alert.lon != null) params.alertLon = String(alert.lon);
              router.push({ pathname: "/(tabs)/MapScreen", params });
            }}
          >
            <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold }}>Ver en mapa</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: colors.brandBlue }]}
            activeOpacity={0.7}
            onPress={() => {
              track("details_boletin_tap", { alertId: String(alert.id), level: Number(alert.level), score: Number(alert.score ?? 0) });
              handleOpenBoletin();
            }}
          >
            <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold }}>Ver Boletín oficial</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  glassCard: {
    backgroundColor: 'rgba(10, 28, 50, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
  },
  ctaButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
