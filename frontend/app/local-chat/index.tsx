import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import ScreenHeader from "../../components/ScreenHeader";
import { colors } from "../../utils/theme";
import { BlockedList } from "./_components/BlockedList";
import { ConnectionToggles } from "./_components/ConnectionToggles";
import { ConversationList } from "./_components/ConversationList";
import { NicknameModal } from "./_components/NicknameModal";
import { PeerList } from "./_components/PeerList";
import { StatusHero } from "./_components/StatusHero";
import { TechLog } from "./_components/TechLog";
import { useLocalChatContext } from "./_context/LocalChatProvider";
import { useCurrentPlan } from '../subscription/_hooks/useCurrentPlan';
import { canAccessFeature } from "../subscription/_utils/planAccess";

function openChat(peerId: string, nickname: string) {
  router.push({ pathname: "/local-chat/chat", params: { peerId, nickname } });
}

export default function LocalChatLobbyScreen() {
  const chat = useLocalChatContext();
  const [editing, setEditing] = useState(false);
  const currentPlan = useCurrentPlan();
  const blockedByPlan = !canAccessFeature(currentPlan, 'bluetooth');



  const connectedName =
    chat.connectedPeers.length === 1
      ? chat.connectedPeers[0].nickname
      : chat.connectedPeers.length > 1
        ? `${chat.connectedPeers.length} personas`
        : undefined;

  const inRangeIds = new Set(chat.peers.map((p) => p.deviceId));
  const connectedPeerIds = new Set(chat.connectedPeers.map((p) => p.deviceId));

  if (blockedByPlan) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
        <ScreenHeader title="Chat offline" />
        <View className="flex-1 px-4 py-6">
          <View className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-5">
            <Text className="font-poppins-semibold text-xl text-white">
              Funcion bloqueada
            </Text>
            <Text className="mt-3 font-poppins text-sm text-white/80">
              El acceso Bluetooth offline requiere un plan Safe o Guard.
            </Text>
            <Pressable
              onPress={() => router.push("/subscription")}
              className="mt-5 rounded-2xl bg-cyan-500 px-4 py-4 items-center active:opacity-80"
            >
              <Text className="font-poppins-semibold text-slate-950">
                Ver suscripcion
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Chat offline" />

      {/* Identity row */}
      <Pressable
        onPress={() => setEditing(true)}
        className="mx-4 mt-2 flex-row items-center justify-between rounded-2xl border border-white/10 bg-brand-surface px-4 py-3 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons
            name="account-circle"
            size={20}
            color="white"
          />
          <Text className="font-poppins text-sm text-white/70">
            Tú:{" "}
            <Text className="font-poppins-semibold text-white">
              {chat.nickname || "Sin nombre"}
            </Text>
          </Text>
        </View>
        <MaterialCommunityIcons
          name="pencil"
          size={18}
          color="rgba(255,255,255,0.6)"
        />
      </Pressable>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 36, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* On an unsupported platform this isn't a fault, it's an unshipped
            feature — but StatusHero only knows "error", so handing it the
            provider's platform message rendered a red "Algo falló". Same
            information, wrong story: a user reads it as a broken app rather
            than one that hasn't got there yet. */}
        {chat.supported ? (
          <StatusHero
            advertising={chat.advertising}
            discovering={chat.discovering}
            connecting={chat.connecting}
            peerName={connectedName}
            error={chat.error}
          />
        ) : (
          <View className="rounded-2xl border border-white/10 bg-brand-surface p-5">
            <View className="flex-row items-center gap-3">
              <MaterialCommunityIcons
                name="clock-outline"
                size={26}
                color="rgba(255,255,255,0.7)"
              />
              <Text className="font-poppins-semibold text-lg text-white">
                Próximamente en iPhone
              </Text>
            </View>
            <Text className="mt-3 font-poppins text-sm leading-5 text-white/60">
              El chat sin internet se conecta directo con teléfonos cercanos por
              Bluetooth. Por ahora funciona solo en Android — estamos trabajando
              en la versión para iPhone.
            </Text>
          </View>
        )}

        {chat.supported ? (
          <>
            <ConnectionToggles
              advertising={chat.advertising}
              discovering={chat.discovering}
              busy={
                chat.advertising ||
                chat.discovering ||
                chat.connecting ||
                chat.connectedPeers.length > 0
              }
              disabled={!chat.available}
              onToggleAdvertise={chat.toggleAdvertise}
              onToggleDiscover={chat.toggleDiscover}
              onStop={chat.resetSession}
            />

            {/* Mesh: una sala compartida, distinta de los hilos 1-a-1 de abajo. */}
            <Pressable
              onPress={() => router.push("/local-chat/mesh")}
              android_ripple={{ color: "rgba(255,255,255,0.12)" }}
              className="flex-row items-center justify-between overflow-hidden rounded-2xl border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-3.5 active:opacity-70"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-cyan/20">
                  <MaterialCommunityIcons name="lan" size={18} color={colors.brandCyan} />
                </View>
                <View>
                  <Text className="font-poppins-semibold text-sm text-white">
                    Sala mesh
                  </Text>
                  <Text className="font-poppins text-xs text-white/50">
                    Un mensaje le llega a todos, directo o por salto
                  </Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="white" />
            </Pressable>

            <PeerList
              peers={chat.peers}
              connectedPeerIds={connectedPeerIds}
              onOpen={(peer) => openChat(peer.deviceId, peer.nickname)}
              onBlock={(peer) => chat.blockPeer(peer.deviceId)}
            />

            <ConversationList
              conversations={chat.conversations}
              inRangeIds={inRangeIds}
              onOpen={openChat}
            />

            <BlockedList
              blockedDeviceIds={chat.blockedDeviceIds}
              onUnblock={chat.unblockPeer}
            />

            {/* Dev-only: hidden in release builds (preview/production). */}
            {__DEV__ ? <TechLog logs={chat.logs} /> : null}
          </>
        ) : null}
      </ScrollView>

      <NicknameModal
        visible={editing}
        initial={chat.nickname}
        dismissable
        onSave={(n) => {
          chat.setNickname(n);
          setEditing(false);
        }}
        onClose={() => setEditing(false)}
      />
    </SafeAreaView>
  );
}
