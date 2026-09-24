import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { FlashList } from "@shopify/flash-list";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import ScreenHeader from "../../components/ScreenHeader";
import { colors } from "../../utils/theme";
import { useCurrentPlan } from '../subscription/_hooks/useCurrentPlan';
import { canAccessFeature } from "../subscription/_utils/planAccess";
import {
  MAX_MESSAGE_LENGTH,
  useLocalChatContext,
} from "./_context/LocalChatProvider";
import type { LocalMessage, MessageStatus } from "./_types";

const STATUS_LABEL: Record<MessageStatus, string> = {
  sending: "Enviando…",
  sent: "Enviado",
  failed: "No enviado",
  queued: "En cola · se enviará al reconectar",
};

function Bubble({ message }: { message: LocalMessage }) {
  if (message.author === "system") {
    return (
      <Text className="my-1 self-center rounded-full bg-white/5 px-3 py-1.5 font-poppins text-xs text-white/60">
        {message.body}
      </Text>
    );
  }
  const self = message.author === "self";
  return (
    <View className={`mb-2 ${self ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
          self ? "rounded-tr-sm bg-brand-blue" : "rounded-tl-sm bg-white/10"
        }`}
      >
        <Text className="font-poppins text-base text-white">
          {message.body}
        </Text>
      </View>
      {self && message.status ? (
        <Text
          className={`mt-1 font-poppins text-[10px] ${
            message.status === "failed" ? "text-brand-red" : "text-white/40"
          }`}
        >
          {STATUS_LABEL[message.status]}
        </Text>
      ) : null}
    </View>
  );
}

export default function LocalChatConversationScreen() {
  const params = useLocalSearchParams<{ peerId?: string; nickname?: string }>();
  const peerId = params.peerId ?? "";
  const currentPlan = useCurrentPlan();
  const blockedByPlan = !canAccessFeature(currentPlan, 'bluetooth');

  const {
    getConversation,
    clearConversation,
    sendMessage,
    isPeerInRange,
    isPeerConnected,
    connectToPeer,
    peers,
  } = useLocalChatContext();

  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const convo = getConversation(peerId);

  const inRange = isPeerInRange(peerId);
  const connected = isPeerConnected(peerId);
  const peerName = convo?.peerNickname ?? params.nickname ?? "Desconocido";

  // FlashList renders top→bottom; our store is newest-first, so reverse for
  // chronological reading (matches the AI screen's non-inverted list).
  const data = useMemo(
    () => [...(convo?.messages ?? [])].reverse(),
    [convo?.messages],
  );



  // Auto-connect once when the peer is in range but not yet connected.
  const triedConnect = useRef(false);
  useEffect(() => {
    if (connected) {
      triedConnect.current = false; // allow a fresh attempt after a drop
      return;
    }
    if (inRange && !triedConnect.current) {
      const endpointId = peers.find((p) => p.deviceId === peerId)?.endpointId;
      if (endpointId) {
        triedConnect.current = true;
        connectToPeer(endpointId);
      }
    }
  }, [inRange, connected, peers, peerId, connectToPeer]);

  const status = connected
    ? { label: "Conectado", color: colors.brandGreen }
    : inRange
      ? { label: "En rango · conectando…", color: colors.brandYellow }
      : { label: "Fuera de rango", color: "rgba(255,255,255,0.5)" };

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage(peerId, text);
    setDraft("");
  };

  const handleClear = () => {
    if (data.length === 0) return;
    Alert.alert(
      "Limpiar chat",
      "Se borrarán los mensajes de esta conversación en este dispositivo. No se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpiar",
          style: "destructive",
          onPress: () => clearConversation(peerId),
        },
      ],
    );
  };

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
            <TouchableOpacity
              onPress={() => router.push("/subscription")}
              className="mt-5 rounded-2xl bg-cyan-500 px-4 py-4 items-center active:opacity-80"
            >
              <Text className="font-poppins-semibold text-slate-950">
                Ver suscripcion
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title={peerName} />

      {/* Clear conversation — same icon/style as the AI chat's restart */}
      {data.length > 0 ? (
        <TouchableOpacity
          onPress={handleClear}
          hitSlop={8}
          className="absolute right-4 z-50 h-10 w-10 items-center justify-center rounded-full"
          style={{ top: insets.top }}
        >
          <MaterialCommunityIcons name="reload" size={20} color="white" />
        </TouchableOpacity>
      ) : null}

      {/* Connection status line */}
      <View className="flex-row items-center gap-2 px-4 pb-2">
        <View
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: status.color }}
        />
        <Text className="font-poppins text-xs" style={{ color: status.color }}>
          {status.label}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-1 px-3">
          <FlashList
            data={data}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
            renderItem={({ item }) => <Bubble message={item} />}
            ListEmptyComponent={
              <View className="mt-24 items-center px-8">
                <MaterialCommunityIcons
                  name="message-outline"
                  size={36}
                  color="rgba(255,255,255,0.3)"
                />
                <Text className="mt-3 text-center font-poppins text-sm text-white/50">
                  Aún no hay mensajes. Escribe el primero.
                </Text>
              </View>
            }
          />

          {/* Input bar (mirrors the AI chat) */}
          <View className="border-t border-brand-blue/30 py-3">
            <View className="flex-row items-center gap-2">
              <View className="flex-1 rounded-3xl border border-white/30">
                <TextInput
                  className="px-4 py-2 font-poppins text-white"
                  placeholder="Escribe un mensaje…"
                  placeholderTextColor="rgb(156,163,175)"
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={MAX_MESSAGE_LENGTH}
                  multiline
                  onSubmitEditing={handleSend}
                />
              </View>
              <TouchableOpacity
                disabled={!draft.trim()}
                onPress={handleSend}
                className={`h-11 w-11 items-center justify-center rounded-full bg-brand-blue ${
                  draft.trim() ? "active:opacity-70" : "opacity-40"
                }`}
              >
                <MaterialCommunityIcons name="send" size={20} color="white" />
              </TouchableOpacity>
            </View>
            {draft.length >= MAX_MESSAGE_LENGTH ? (
              <Text className="mt-1 px-2 font-poppins text-[10px] text-brand-yellow">
                Máximo {MAX_MESSAGE_LENGTH} caracteres.
              </Text>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
