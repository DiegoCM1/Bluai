import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

/** Blocked deviceIds — a rename can't evade this (see storage.ts). Tap to unblock. */
export function BlockedList({
  blockedDeviceIds,
  onUnblock,
}: {
  blockedDeviceIds: string[];
  onUnblock: (deviceId: string) => void;
}) {
  if (blockedDeviceIds.length === 0) return null;

  return (
    <View className="gap-2">
      <Text className="font-poppins-semibold text-lg text-white">
        Bloqueados
      </Text>
      {blockedDeviceIds.map((id) => (
        <View
          key={id}
          className="flex-row items-center justify-between overflow-hidden rounded-2xl border border-white/10 bg-brand-surface px-4 py-3.5"
        >
          <View className="flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <MaterialCommunityIcons
                name="account-cancel"
                size={18}
                color="white"
              />
            </View>
            <Text
              className="font-poppins-semibold text-sm text-white"
              numberOfLines={1}
            >
              {id}
            </Text>
          </View>
          <Pressable
            onPress={() => onUnblock(id)}
            hitSlop={8}
            className="rounded-lg px-3 py-1.5 active:opacity-60"
          >
            <Text className="font-poppins-semibold text-xs text-brand-cyan">
              Desbloquear
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
