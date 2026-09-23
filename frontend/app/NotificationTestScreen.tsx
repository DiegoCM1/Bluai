import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { toast } from "sonner-native";
import { colors } from "../utils/theme";
import { authFetch } from "../utils/api";
import { API_BASE_URL } from "../utils/config";
import { darkMapStyle } from "./map/mapStyle";
import { DEFAULT_REGION } from "./map/config";

// Same 16-point compass abbreviations the backend's direction.py parses —
// collapsed to 8 for a simpler chip row (backend also accepts the numeric bearing NHC sends).
const COMPASS_DIRECTIONS = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
] as const;
type CompassDirection = (typeof COMPASS_DIRECTIONS)[number];

// Same defaults FakeCycloneRequest uses in backend/app/features/siat/schemas.py
const DEFAULT_CYCLONE_NAME = "FALSO-1";
const DEFAULT_WIND_KMH = "120";
const DEFAULT_SPEED_KMH = "20";
const DEFAULT_DIRECTION: CompassDirection = "NW";
const DEFAULT_LAT = 21.0;
const DEFAULT_LON = -98.0;

export default function NotificationTestScreen() {
  const [cycloneLoading, setCycloneLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const [cycloneName, setCycloneName] = useState(DEFAULT_CYCLONE_NAME);
  const [cycloneLat, setCycloneLat] = useState(String(DEFAULT_LAT));
  const [cycloneLon, setCycloneLon] = useState(String(DEFAULT_LON));
  const [windKmh, setWindKmh] = useState(DEFAULT_WIND_KMH);
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);
  const [direction, setDirection] =
    useState<CompassDirection>(DEFAULT_DIRECTION);
  const [locatingSelf, setLocatingSelf] = useState(false);

  const markerLat = Number(cycloneLat);
  const markerLon = Number(cycloneLon);
  const hasValidMarker =
    Number.isFinite(markerLat) && Number.isFinite(markerLon);

  const useMyLocation = async () => {
    if (locatingSelf) return;
    setLocatingSelf(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        toast.error("Permiso denegado", {
          description:
            "Activa el permiso de ubicación para usar tu posición actual.",
        });
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCycloneLat(coords.latitude.toFixed(5));
      setCycloneLon(coords.longitude.toFixed(5));
    } catch (e) {
      toast.error("No se pudo obtener tu ubicación", {
        description: String(e),
      });
    } finally {
      setLocatingSelf(false);
    }
  };

  const injectCyclone = async () => {
    if (cycloneLoading) return;

    const lat = Number(cycloneLat);
    const lon = Number(cycloneLon);
    const wind = Number(windKmh);
    const speed = Number(speedKmh);

    if (!cycloneName.trim()) {
      toast.error("Nombre requerido", {
        description: "Escribe un nombre para el ciclón de prueba.",
      });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      toast.error("Latitud inválida", {
        description: "Debe ser un número entre -90 y 90.",
      });
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      toast.error("Longitud inválida", {
        description: "Debe ser un número entre -180 y 180.",
      });
      return;
    }
    if (!Number.isFinite(wind) || wind <= 0) {
      toast.error("Viento inválido", {
        description: "Debe ser un número mayor a 0.",
      });
      return;
    }
    if (!Number.isFinite(speed) || speed < 0) {
      toast.error("Velocidad inválida", {
        description: "Debe ser un número mayor o igual a 0.",
      });
      return;
    }

    const body = {
      name: cycloneName.trim(),
      lat,
      lon,
      wind_kmh: wind,
      movement_speed_kmh: speed,
      movement_direction: direction,
    };

    setCycloneLoading(true);
    try {
      console.log("[SIAT] inject-cyclone →", body.name, body);
      const res = await authFetch(
        `${API_BASE_URL}/api/v1/siat/inject-cyclone`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      console.log("[SIAT] inject-cyclone status:", res.status);
      if (res.status === 403) {
        console.warn("[SIAT] inject-cyclone 403 — sin acceso");
        toast.error("Sin acceso", {
          description:
            "Pide que agreguen tu email o número a NOTIFICATION_TEST_ADMIN_EMAILS / NOTIFICATION_TEST_ADMIN_PHONES en backend/.env",
        });
        return;
      }
      if (res.status === 422) {
        const err = await res.json().catch(() => ({}));
        console.warn("[SIAT] inject-cyclone 422 — sin ubicación:", err.detail);
        toast.error("Sin ubicación registrada", {
          description:
            err.detail ||
            "Configura tu ubicación en el perfil antes de inyectar.",
        });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(
        "[SIAT] inject-cyclone OK — users_evaluated:",
        data.users_evaluated,
        "notifications_sent:",
        data.notifications_sent,
        "assessments:",
        data.assessments,
      );
      const firstAssessment = data.assessments?.[0];
      const detail = firstAssessment
        ? `${data.users_evaluated} eval. · Nivel ${firstAssessment.siat_level} ${firstAssessment.siat_color} · ${firstAssessment.distance_km?.toFixed(0)} km`
        : `${data.users_evaluated} evaluado(s)`;
      const notifDesc =
        data.notifications_sent > 0
          ? `Push enviado · ${detail}`
          : `Sin push · ${detail} · (revisa quiet hours o nivel mínimo)`;
      toast.success(`Ciclón inyectado · ${body.name}`, {
        description: notifDesc,
      });
    } catch (e) {
      console.error("[SIAT] inject-cyclone error:", e);
      toast.error("Error al inyectar ciclón", { description: String(e) });
    } finally {
      setCycloneLoading(false);
    }
  };

  const resetSiatState = async () => {
    if (resetLoading) return;
    setResetLoading(true);
    try {
      console.log("[SIAT] reset-state →");
      const res = await authFetch(`${API_BASE_URL}/api/v1/siat/reset-state`, {
        method: "POST",
      });
      console.log("[SIAT] reset-state status:", res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("[SIAT] reset-state OK");
      toast.success("Estado SIAT reiniciado", {
        description: "La siguiente inyección evaluará desde nivel 0.",
      });
    } catch (e) {
      console.error("[SIAT] reset-state error:", e);
      toast.error("Error al reiniciar", { description: String(e) });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      className="flex-1 bg-transparent"
    >
      <ScrollView
        className="flex-1 px-6 pt-6"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-xl font-poppins-semibold text-white mb-1">
          Dev: Notificaciones
        </Text>
        <Text className="text-sm font-poppins text-white/50 mb-6">
          Herramienta interna — solo visible en staging/dev
        </Text>

        {/* Sección: inyección de ciclón falso */}
        <Text className="text-base font-poppins-semibold text-white mt-4 mb-1">
          Motor SIAT — Ciclón Falso
        </Text>
        <Text className="text-xs font-poppins text-white/50 mb-4">
          Crea un ciclón de prueba con los parámetros que quieras y corre el
          ciclo SIAT completo end-to-end.
        </Text>

        <View
          className="mb-4 rounded-2xl overflow-hidden"
          style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}
        >
          <MapView
            provider={PROVIDER_GOOGLE}
            style={{ height: 180 }}
            initialRegion={DEFAULT_REGION}
            customMapStyle={darkMapStyle}
            onPress={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setCycloneLat(latitude.toFixed(5));
              setCycloneLon(longitude.toFixed(5));
            }}
          >
            {hasValidMarker && (
              <Marker
                coordinate={{ latitude: markerLat, longitude: markerLon }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <MaterialCommunityIcons
                  name="weather-hurricane"
                  size={28}
                  color={colors.brandRed}
                />
              </Marker>
            )}
          </MapView>
          <TouchableOpacity
            onPress={useMyLocation}
            disabled={locatingSelf}
            className="flex-row items-center justify-center py-2.5"
            style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
          >
            {locatingSelf ? (
              <ActivityIndicator
                size="small"
                color="white"
                style={{ marginRight: 8 }}
              />
            ) : (
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={16}
                color="white"
                style={{ marginRight: 8 }}
              />
            )}
            <Text className="font-poppins text-xs text-white/70">
              Usar mi ubicación actual
            </Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row gap-3 mb-3">
          <View className="flex-1">
            <Text className="font-poppins text-xs text-white/50 mb-1">
              Latitud
            </Text>
            <TextInput
              value={cycloneLat}
              onChangeText={setCycloneLat}
              keyboardType="numbers-and-punctuation"
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="rounded-lg px-3 py-2 font-poppins text-white"
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}
            />
          </View>
          <View className="flex-1">
            <Text className="font-poppins text-xs text-white/50 mb-1">
              Longitud
            </Text>
            <TextInput
              value={cycloneLon}
              onChangeText={setCycloneLon}
              keyboardType="numbers-and-punctuation"
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="rounded-lg px-3 py-2 font-poppins text-white"
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}
            />
          </View>
        </View>

        <Text className="font-poppins text-xs text-white/50 mb-1">Nombre</Text>
        <TextInput
          value={cycloneName}
          onChangeText={setCycloneName}
          placeholderTextColor="rgba(255,255,255,0.3)"
          className="rounded-lg px-3 py-2 mb-3 font-poppins text-white"
          style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}
        />

        <View className="flex-row gap-3 mb-3">
          <View className="flex-1">
            <Text className="font-poppins text-xs text-white/50 mb-1">
              Viento (km/h)
            </Text>
            <TextInput
              value={windKmh}
              onChangeText={setWindKmh}
              keyboardType="numeric"
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="rounded-lg px-3 py-2 font-poppins text-white"
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}
            />
          </View>
          <View className="flex-1">
            <Text className="font-poppins text-xs text-white/50 mb-1">
              Velocidad (km/h)
            </Text>
            <TextInput
              value={speedKmh}
              onChangeText={setSpeedKmh}
              keyboardType="numeric"
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="rounded-lg px-3 py-2 font-poppins text-white"
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}
            />
          </View>
        </View>

        <Text className="font-poppins text-xs text-white/50 mb-2">Rumbo</Text>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {COMPASS_DIRECTIONS.map((dir) => (
            <TouchableOpacity
              key={dir}
              onPress={() => setDirection(dir)}
              className="rounded-full px-4 py-2"
              style={{
                backgroundColor:
                  direction === dir
                    ? colors.brandBlue
                    : "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor:
                  direction === dir
                    ? colors.brandBlue
                    : "rgba(255,255,255,0.2)",
              }}
            >
              <Text className="font-poppins-semibold text-xs text-white">
                {dir}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={injectCyclone}
          disabled={cycloneLoading}
          className="flex-row items-center justify-center mb-4 rounded-2xl px-5 py-4"
          style={{
            backgroundColor: `${colors.brandRed}22`,
            borderWidth: 1,
            borderColor: colors.brandRed,
            opacity: cycloneLoading ? 0.6 : 1,
          }}
        >
          {cycloneLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.brandRed}
              style={{ marginRight: 12 }}
            />
          ) : (
            <MaterialCommunityIcons
              name="weather-hurricane"
              size={22}
              color={colors.brandRed}
              style={{ marginRight: 12 }}
            />
          )}
          <Text className="font-poppins-semibold text-sm text-white">
            Inyectar ciclón
          </Text>
        </TouchableOpacity>

        {/* Reset estado SIAT */}
        <TouchableOpacity
          onPress={resetSiatState}
          disabled={resetLoading}
          className="flex-row items-center mb-8 rounded-2xl px-5 py-4"
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.2)",
          }}
        >
          {resetLoading ? (
            <ActivityIndicator
              size="small"
              color="white"
              style={{ marginRight: 12 }}
            />
          ) : (
            <MaterialCommunityIcons
              name="refresh"
              size={22}
              color="white"
              style={{ marginRight: 12 }}
            />
          )}
          <View className="flex-1">
            <Text className="font-poppins-semibold text-sm text-white">
              Limpiar estado SIAT
            </Text>
            <Text className="font-poppins text-xs text-white/50">
              Permite volver a disparar escalación desde el mismo nivel
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
