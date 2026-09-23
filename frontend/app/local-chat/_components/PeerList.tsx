import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Alert, Pressable, Text, View } from "react-native";

import { colors } from "../../../utils/theme";
import type { DiscoveredPeer } from "../_types";

/** In-range devices. Tapping one opens the conversation (and connects). Long-press to block. */
export function PeerList({
  peers,
  connectedPeerIds,
  onOpen,
  onBlock,
}: {
  peers: DiscoveredPeer[];
  connectedPeerIds: Set<string>;
  onOpen: (peer: DiscoveredPeer) => void;
  onBlock?: (peer: DiscoveredPeer) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="font-poppins-semibold text-lg text-white">
        Dispositivos cercanos
      </Text>
      {peers.length === 0 ? (
        <Text className="font-poppins text-sm text-white/50">
          Nadie por aquí todavía. Activa “Buscar gente”.
        </Text>
      ) : (
        peers.map((peer) => {
          const isConnected = connectedPeerIds.has(peer.deviceId);
          return (
            <Pressable
              key={peer.deviceId}
              onPress={() => onOpen(peer)}
              onLongPress={
                onBlock
                  ? () =>
                      Alert.alert(
                        "Bloquear a " + peer.nickname,
                        "No podrás recibir mensajes de este dispositivo. Puedes desbloquearlo después.",
                        [
                          { text: "Cancelar", style: "cancel" },
                          {
                            text: "Bloquear",
                            style: "destructive",
                            onPress: () => onBlock(peer),
                          },
                        ],
                      )
                  : undefined
              }
              android_ripple={{ color: "rgba(255,255,255,0.12)" }}
              className="flex-row items-center justify-between overflow-hidden rounded-2xl border border-white/10 bg-brand-surface px-4 py-3.5 active:opacity-70"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-white/10">
                  <MaterialCommunityIcons
                    name="account"
                    size={18}
                    color="white"
                  />
                </View>
                <View>
                  <Text className="font-poppins-semibold text-sm text-white">
                    {peer.nickname}
                  </Text>
                  <Text className="font-poppins text-xs text-white/40">
                    {isConnected ? "Conectado" : "Toca para conectar"}
                  </Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name={isConnected ? "check-circle" : "chevron-right"}
                size={20}
                color={isConnected ? colors.brandGreen : "white"}
              />
            </Pressable>
          );
        })
      )}
    </View>
  );
}
