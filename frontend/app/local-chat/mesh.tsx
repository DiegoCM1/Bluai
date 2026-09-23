import { useMemo, useState } from "react";
import {
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import ScreenHeader from "../../components/ScreenHeader";
import { colors } from "../../utils/theme";
import {
  MAX_MESSAGE_LENGTH,
  useLocalChatContext,
} from "./_context/LocalChatProvider";
import type { LocalMessage } from "./_types";

/**
 * Mesh broadcast room: unlike 1-a-1 (a thread per peer), this is ONE shared
 * room where anything sent reaches every peer reachable — directly or by
 * hop. See docs/specs_july05/val_sprint_3.md Capa 3.
 */
function Bubble({ message }: { message: LocalMessage }) {
  const self = message.author === "self";
  return (
    <View className={`mb-2 ${self ? "items-end" : "items-start"}`}>
      {!self ? (
        <Text className="mb-0.5 ml-1 font-poppins text-[11px] text-white/40">
          {message.peerId}
        </Text>
      ) : null}
      <View
        className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
          self ? "rounded-tr-sm bg-brand-blue" : "rounded-tl-sm bg-white/10"
        }`}
      >
        <Text className="font-poppins text-base text-white">
          {message.body}
        </Text>
      </View>
    </View>
  );
}

export default function LocalChatMeshScreen() {
  const { meshMessages, meshRoster, sendMeshMessage } = useLocalChatContext();
  const [draft, setDraft] = useState("");

  const data = useMemo(() => [...meshMessages].reverse(), [meshMessages]);
  const directCount = meshRoster.filter((p) => !p.viaHop).length;
  const hopCount = meshRoster.filter((p) => p.viaHop).length;

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    sendMeshMessage(text);
    setDraft("");
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Sala mesh" />

      {/* Roster: directo vs por salto — esto es lo que hace visible el mesh */}
      <View className="flex-row flex-wrap items-center gap-2 px-4 pb-2">
        {meshRoster.length === 0 ? (
          <Text className="font-poppins text-xs text-white/50">
            Nadie más en la sala todavía.
          </Text>
        ) : (
          <>
            <View className="flex-row items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colors.brandGreen }}
              />
              <Text className="font-poppins text-xs text-white/70">
                {directCount} directo{directCount === 1 ? "" : "s"}
              </Text>
            </View>
            {hopCount > 0 ? (
              <View className="flex-row items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colors.brandYellow }}
                />
                <Text className="font-poppins text-xs text-white/70">
                  {hopCount} por salto
                </Text>
              </View>
            ) : null}
          </>
        )}
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
                  name="lan"
                  size={36}
                  color="rgba(255,255,255,0.3)"
                />
                <Text className="mt-3 text-center font-poppins text-sm text-white/50">
                  Aún no hay mensajes en la sala. Lo que escribas le llega a
                  todos los alcanzables, directo o por salto.
                </Text>
              </View>
            }
          />

          <View className="border-t border-brand-blue/30 py-3">
            <View className="flex-row items-center gap-2">
              <View className="flex-1 rounded-3xl border border-white/30">
                <TextInput
                  className="px-4 py-2 font-poppins text-white"
                  placeholder="Mensaje para la sala…"
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
