import { useEffect } from "react";
import { Modal, View, Text, TouchableOpacity } from "react-native";
import { Link, useRouter, useLocalSearchParams } from "expo-router";
import { colorForLevel } from "./alerts/_components/AlertCard";

export default function AlarmScreen() {
  const { alertId, category, title, message } = useLocalSearchParams();
  const router = useRouter();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    console.log('[QA_NAV] AlarmScreen mounted | alertId:', alertId ?? 'none', '| category:', category, '| title:', title);
  }, []);

  const alertData = {
    id:       alertId  || null,
    category: Number(category) || 4,
    title:    String(title   || "Alerta de emergencia"),
    message:  String(message || "Siga las indicaciones de las autoridades."),
  };

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/MapScreen");
    }
  };

  const handleMap = () => {
    router.replace("/(tabs)/MapScreen");
  };

  const baseColor = colorForLevel(alertData.category);
  const buttonColor = `${baseColor}50`;
  const categoryBadgeColor = `${baseColor}90`;

  return (
    <Modal animationType="slide" transparent visible onRequestClose={handleClose}>
      <View className="flex-1 justify-center items-center bg-black/70">
        <View
          className="w-11/12 max-w-md rounded-2xl p-6 shadow-xl bg-white"
          style={{ borderColor: baseColor, borderWidth: 2 }}
        >
          {/* Badge de categoría */}
          <View className="flex-row justify-center mb-4">
            <View
              className="px-4 py-2 rounded-full"
              style={{ backgroundColor: categoryBadgeColor }}
            >
              <Text className="text-white font-bold text-sm">
                Nivel {alertData.category}
              </Text>
            </View>
          </View>

          {/* Título */}
          <Text className="text-2xl font-extrabold text-center mb-4" style={{ color: '#111827' }}>
            {alertData.title}
          </Text>

          {/* Mensaje breve */}
          <Text className="text-base text-center mb-6" style={{ color: '#374151' }}>
            {alertData.message}
          </Text>

          {/* Botones */}
          <View className="flex-row justify-between mb-6">
            <TouchableOpacity
              onPress={handleMap}
              accessibilityRole="button"
              className="flex-1 mr-2 py-3 rounded-lg items-center"
              style={{ backgroundColor: buttonColor }}
            >
              <Text className="font-bold" style={{ color: baseColor }}>Ver en el mapa</Text>
            </TouchableOpacity>

            <Link href={alertData.id ? `/alerts/${alertData.id}` : "/alerts"} asChild>
              <TouchableOpacity
                className="flex-1 ml-2 py-3 rounded-lg items-center"
                style={{ backgroundColor: buttonColor }}
                accessibilityRole="button"
                onPress={() => console.log('[QA_NAV] AlarmScreen → más info | alertId:', alertData.id ?? 'none', '| href:', alertData.id ? `/alerts/${alertData.id}` : "/alerts")}
              >
                <Text className="font-bold" style={{ color: baseColor }}>Más información</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* Cerrar */}
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            className="py-2 rounded-lg items-center border-2"
            style={{ borderColor: baseColor }}
          >
            <Text className="font-bold" style={{ color: baseColor }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
