import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { NICKNAME_MAX, NICKNAME_MIN } from "../_services/identity";

/**
 * Nickname editor. Doubles as the forced first-run gate (`dismissable={false}`)
 * and the editable-from-lobby modal. Validation mirrors the spec: 2-20 chars,
 * trimmed.
 */
export function NicknameModal({
  visible,
  initial,
  dismissable,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: string;
  dismissable: boolean;
  onSave: (nickname: string) => void;
  onClose?: () => void;
}) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);

  const trimmed = value.trim();
  const valid =
    trimmed.length >= NICKNAME_MIN && trimmed.length <= NICKNAME_MAX;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissable ? onClose : undefined}
    >
      {/* keyboard-controller (not RN's) — it supports Modal windows on Android
          since 1.13. "padding" on both platforms shrinks the backdrop by the
          keyboard height, so the centered card re-centers above it. The
          ScrollView keeps a taller card reachable on small screens. `style`, not
          `className`: third-party, no cssInterop → className drops silently. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)" }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="flex-grow items-center justify-center px-6 py-6"
          bounces={false}
        >
          <View className="w-full rounded-2xl border border-white/10 bg-brand-surface p-6">
            <Text className="font-poppins-semibold text-lg text-white">
              ¿Cómo te llamas?
            </Text>
            <Text className="mt-1 font-poppins text-sm text-white/60">
              Así te verán los teléfonos cercanos. Puedes cambiarlo después.
            </Text>

            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="Tu nombre"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoFocus
              maxLength={NICKNAME_MAX}
              className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-poppins text-base text-white"
            />
            <Text className="mt-2 font-poppins text-xs text-white/40">
              {trimmed.length}/{NICKNAME_MAX} · mínimo {NICKNAME_MIN} caracteres
            </Text>

            <View className="mt-5 flex-row justify-end gap-3">
              {dismissable ? (
                <Pressable
                  onPress={onClose}
                  className="rounded-xl px-4 py-2.5 active:opacity-60"
                >
                  <Text className="font-poppins-semibold text-sm text-white/60">
                    Cancelar
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={!valid}
                onPress={() => onSave(trimmed)}
                android_ripple={{ color: "rgba(255,255,255,0.2)" }}
                className={`overflow-hidden rounded-xl bg-brand-blue px-5 py-2.5 active:opacity-70 ${
                  valid ? "" : "opacity-40"
                }`}
              >
                <Text className="font-poppins-semibold text-sm text-white">
                  Guardar
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
