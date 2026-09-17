import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Stack } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

import ScreenHeader from "../components/ScreenHeader";
import { authFetch } from "../utils/api";
import { API_BASE_URL } from "../utils/config";
import { colors, fonts, gradients } from "../utils/theme";

type Room = {
  id: number;
  name: string | null;
  type: string;
  created_at: string;
};

type Message = {
  id: number;
  room_id: number;
  user_uid: string | null;
  body?: string;
  kind?: "text" | "voice";
  audioUri?: string | null;
  durationMs?: number;
  created_at: string;
};

const LOCAL_CHAT_ROOMS_KEY = "@BluEye:localChatRooms";
const LOCAL_CHAT_MESSAGES_KEY = "@BluEye:localChatMessages";
const ALERT_SOUND_URL = "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";

async function localChatFetch(path: string, options: RequestInit = {}) {
  const response = await authFetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || `Local chat request failed: ${response.status}`);
  }

  return response;
}

async function loadLocalRooms(): Promise<Room[]> {
  const raw = await AsyncStorage.getItem(LOCAL_CHAT_ROOMS_KEY);
  return raw ? (JSON.parse(raw) as Room[]) : [];
}

async function saveLocalRooms(rooms: Room[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CHAT_ROOMS_KEY, JSON.stringify(rooms));
}

async function loadLocalMessages(): Promise<Record<string, Message[]>> {
  const raw = await AsyncStorage.getItem(LOCAL_CHAT_MESSAGES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, Message[]>) : {};
}

async function saveLocalMessages(messagesByRoom: Record<string, Message[]>): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CHAT_MESSAGES_KEY, JSON.stringify(messagesByRoom));
}

function formatDuration(durationMs?: number) {
  const totalSeconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function LocalChatScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomName, setRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [recordingReady, setRecordingReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const recordingLabel = useMemo(() => {
    if (!isRecording) {
      return null;
    }

    return `Grabando nota de voz... ${formatDuration(recorderState.durationMillis)}`;
  }, [isRecording, recorderState.durationMillis]);

  const playAlertSound = useCallback(async () => {
    try {
      const player = createAudioPlayer({ uri: ALERT_SOUND_URL });
      player.play();
      setTimeout(() => {
        player.remove();
      }, 2500);
    } catch (error) {
      console.warn("[LocalChat] Failed to play alert sound:", error);
    }
  }, []);

  const loadRooms = useCallback(
    async (nextRoomId?: number) => {
      setLoadingRooms(true);
      try {
        const response = await localChatFetch("/api/v1/chat/rooms");
        const payload = (await response.json()) as Room[];
        setIsOfflineFallback(false);
        setRooms(payload);

        const targetRoom =
          payload.find((room) => room.id === nextRoomId) ??
          payload.find((room) => room.id === selectedRoom?.id) ??
          payload[0] ??
          null;
        setSelectedRoom(targetRoom);
      } catch (error) {
        console.warn("[LocalChat] Falling back to local rooms:", error);
        const payload = await loadLocalRooms();
        setIsOfflineFallback(true);
        setRooms(payload);
        const targetRoom =
          payload.find((room) => room.id === nextRoomId) ??
          payload.find((room) => room.id === selectedRoom?.id) ??
          payload[0] ??
          null;
        setSelectedRoom(targetRoom);
      } finally {
        setLoadingRooms(false);
      }
    },
    [selectedRoom?.id],
  );

  const loadMessages = useCallback(async (roomId: number) => {
    setLoadingMessages(true);
    try {
      const response = await localChatFetch(
        `/api/v1/chat/rooms/${roomId}/messages?limit=100`,
      );
      const payload = (await response.json()) as Message[];
      setIsOfflineFallback(false);
      setMessages(payload.slice().reverse());
    } catch (error) {
      console.warn("[LocalChat] Falling back to local messages:", error);
      const messagesByRoom = await loadLocalMessages();
      setIsOfflineFallback(true);
      setMessages(messagesByRoom[String(roomId)] ?? []);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (selectedRoom) {
      loadMessages(selectedRoom.id);
      return;
    }

    setMessages([]);
  }, [loadMessages, selectedRoom]);

  useEffect(() => {
    const prepareAudio = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        });
        setRecordingReady(true);
      } catch (error) {
        console.warn("[LocalChat] Failed to prepare audio mode:", error);
      }
    };

    prepareAudio();
  }, []);

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      Alert.alert("Nueva sala", "Escribe un nombre para la sala.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await localChatFetch("/api/v1/chat/rooms", {
        method: "POST",
        body: JSON.stringify({ name: roomName.trim(), type: "group" }),
      });
      setIsOfflineFallback(false);
      const room = (await response.json()) as Room;
      setRoomName("");
      await loadRooms(room.id);
    } catch (error) {
      console.warn("[LocalChat] Falling back to local room creation:", error);
      const localRoom: Room = {
        id: Date.now(),
        name: roomName.trim(),
        type: "group",
        created_at: new Date().toISOString(),
      };
      const nextRooms = [...(await loadLocalRooms()), localRoom];
      await saveLocalRooms(nextRooms);
      setIsOfflineFallback(true);
      setRoomName("");
      setRooms(nextRooms);
      setSelectedRoom(localRoom);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinRoom = async () => {
    const roomId = Number(joinRoomId);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      Alert.alert("Unirse", "Ingresa un ID de sala valido.");
      return;
    }

    setSubmitting(true);
    try {
      await localChatFetch(`/api/v1/chat/rooms/${roomId}/join`, {
        method: "POST",
      });
      setIsOfflineFallback(false);
      setJoinRoomId("");
      await loadRooms(roomId);
    } catch (error) {
      console.warn("[LocalChat] Falling back to local room join:", error);
      const localRooms = await loadLocalRooms();
      const room = localRooms.find((item) => item.id === roomId);
      if (!room) {
        Alert.alert("Unirse", "No existe una sala local con ese ID.");
      } else {
        setIsOfflineFallback(true);
        setJoinRoomId("");
        setSelectedRoom(room);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    if (!selectedRoom) {
      Alert.alert("Chat local", "Selecciona una sala primero.");
      return;
    }
    if (!draft.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await localChatFetch(`/api/v1/chat/rooms/${selectedRoom.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: draft.trim() }),
      });
      setIsOfflineFallback(false);
      setDraft("");
      await loadMessages(selectedRoom.id);
    } catch (error) {
      console.warn("[LocalChat] Falling back to local message send:", error);
      const messagesByRoom = await loadLocalMessages();
      const roomKey = String(selectedRoom.id);
      const localMessage: Message = {
        id: Date.now(),
        room_id: selectedRoom.id,
        user_uid: "local-device",
        body: draft.trim(),
        kind: "text",
        created_at: new Date().toISOString(),
      };
      const nextMessages = [...(messagesByRoom[roomKey] ?? []), localMessage];
      const nextMessagesByRoom = {
        ...messagesByRoom,
        [roomKey]: nextMessages,
      };
      await saveLocalMessages(nextMessagesByRoom);
      setIsOfflineFallback(true);
      setDraft("");
      setMessages(nextMessages);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRecording = async () => {
    if (!selectedRoom) {
      Alert.alert("Chat local", "Selecciona una sala primero.");
      return;
    }

    if (!recordingReady) {
      Alert.alert("Audio", "El audio aun no esta listo. Intenta de nuevo.");
      return;
    }

    try {
      if (!isRecording) {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Audio", "Necesito permiso para usar el microfono.");
          return;
        }

        await recorder.prepareToRecordAsync();
        recorder.record();
        setIsRecording(true);
        return;
      }

      await recorder.stop();
      setIsRecording(false);

      if (!recorder.uri) {
        Alert.alert("Audio", "No se pudo guardar la nota de voz.");
        return;
      }

      const roomKey = String(selectedRoom.id);
      const messagesByRoom = await loadLocalMessages();
      const localMessage: Message = {
        id: Date.now(),
        room_id: selectedRoom.id,
        user_uid: "local-device",
        kind: "voice",
        audioUri: recorder.uri,
        durationMs: recorderState.durationMillis,
        created_at: new Date().toISOString(),
      };
      const nextMessages = [...(messagesByRoom[roomKey] ?? []), localMessage];
      const nextMessagesByRoom = {
        ...messagesByRoom,
        [roomKey]: nextMessages,
      };

      await saveLocalMessages(nextMessagesByRoom);
      setIsOfflineFallback(true);
      setMessages(nextMessages);
      await playAlertSound();
    } catch (error) {
      setIsRecording(false);
      console.warn("[LocalChat] Failed to record voice note:", error);
      Alert.alert("Audio", "No se pudo grabar la nota de voz.");
    }
  };

  const handlePlayVoiceMessage = async (message: Message) => {
    if (!message.audioUri) {
      return;
    }

    try {
      setPlayingMessageId(message.id);
      const player = createAudioPlayer({ uri: message.audioUri });
      player.play();
      setTimeout(() => {
        player.remove();
        setPlayingMessageId((current) => (current === message.id ? null : current));
      }, Math.max((message.durationMs ?? 1500) + 500, 2000));
    } catch (error) {
      setPlayingMessageId(null);
      console.warn("[LocalChat] Failed to play voice note:", error);
      Alert.alert("Audio", "No se pudo reproducir la nota de voz.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Chat local" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16, gap: 16 }}
        >
          <LinearGradient
            colors={gradients.header}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: 24, padding: 16 }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#fff",
                    fontFamily: fonts.poppinsSemiBold,
                    fontSize: 18,
                  }}
                >
                  Nearby listo para pruebas
                </Text>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.72)",
                    fontFamily: fonts.poppins,
                    marginTop: 6,
                  }}
                >
                  Crea una sala, comparte el ID y manda mensajes entre dispositivos
                  autenticados.
                </Text>
              </View>
              <Pressable onPress={playAlertSound} hitSlop={8} style={iconButton}>
                <MaterialCommunityIcons name="bell-ring-outline" size={20} color="#fff" />
              </Pressable>
            </View>
            {isOfflineFallback && (
              <Text
                style={{
                  color: "#d7e7ff",
                  fontFamily: fonts.poppinsSemiBold,
                  marginTop: 10,
                }}
              >
                Modo local activo: sin conexion al backend.
              </Text>
            )}
            {recordingLabel && (
              <Text
                style={{
                  color: "#fff",
                  fontFamily: fonts.poppinsSemiBold,
                  marginTop: 10,
                }}
              >
                {recordingLabel}
              </Text>
            )}
          </LinearGradient>

          <View style={{ gap: 10 }}>
            <TextInput
              value={roomName}
              onChangeText={setRoomName}
              placeholder="Nombre de nueva sala"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={inputStyle}
            />
            <Pressable
              onPress={handleCreateRoom}
              disabled={submitting}
              style={primaryButton}
            >
              <Text style={primaryButtonText}>Crear sala</Text>
            </Pressable>
          </View>

          <View style={{ gap: 10 }}>
            <TextInput
              value={joinRoomId}
              onChangeText={setJoinRoomId}
              placeholder="ID de sala para unirte"
              placeholderTextColor="rgba(255,255,255,0.45)"
              keyboardType="number-pad"
              style={inputStyle}
            />
            <Pressable
              onPress={handleJoinRoom}
              disabled={submitting}
              style={secondaryButton}
            >
              <Text style={secondaryButtonText}>Unirme</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1, gap: 12 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontFamily: fonts.poppinsSemiBold,
                  fontSize: 16,
                }}
              >
                Salas
              </Text>
              <Pressable onPress={() => loadRooms()} hitSlop={8}>
                <MaterialCommunityIcons name="refresh" size={22} color="#fff" />
              </Pressable>
            </View>

            {loadingRooms ? (
              <ActivityIndicator color={colors.brandBlue} />
            ) : (
              <FlatList
                horizontal
                data={rooms}
                keyExtractor={(item) => String(item.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
                renderItem={({ item }) => {
                  const active = selectedRoom?.id === item.id;
                  return (
                    <Pressable
                      onPress={() => setSelectedRoom(item)}
                      style={{
                        minWidth: 132,
                        borderRadius: 18,
                        padding: 14,
                        backgroundColor: active
                          ? colors.brandBlue
                          : "rgba(255,255,255,0.08)",
                        borderWidth: 1,
                        borderColor: active
                          ? colors.brandBlue
                          : "rgba(255,255,255,0.12)",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontFamily: fonts.poppinsSemiBold,
                        }}
                      >
                        {item.name || `Sala ${item.id}`}
                      </Text>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.65)",
                          fontFamily: fonts.poppins,
                          fontSize: 12,
                          marginTop: 4,
                        }}
                      >
                        ID {item.id}
                      </Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      fontFamily: fonts.poppins,
                    }}
                  >
                    Aun no tienes salas. Crea una o unete con un ID.
                  </Text>
                }
              />
            )}

            <View
              style={{
                flex: 1,
                borderRadius: 24,
                backgroundColor: "rgba(8,15,30,0.85)",
                padding: 14,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontFamily: fonts.poppinsSemiBold,
                    fontSize: 16,
                  }}
                >
                  {selectedRoom
                    ? selectedRoom.name || `Sala ${selectedRoom.id}`
                    : "Mensajes"}
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {selectedRoom && (
                    <Pressable
                      onPress={() => loadMessages(selectedRoom.id)}
                      hitSlop={8}
                      style={iconButton}
                    >
                      <MaterialCommunityIcons
                        name="refresh"
                        size={20}
                        color="#fff"
                      />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={handleToggleRecording}
                    hitSlop={8}
                    style={[
                      iconButton,
                      isRecording && { backgroundColor: "rgba(255,87,87,0.28)" },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={isRecording ? "stop-circle-outline" : "microphone-outline"}
                      size={20}
                      color="#fff"
                    />
                  </Pressable>
                </View>
              </View>

              {loadingMessages ? (
                <ActivityIndicator color={colors.brandBlue} />
              ) : (
                <FlatList
                  data={messages}
                  keyExtractor={(item) => String(item.id)}
                  contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
                  renderItem={({ item }) => (
                    <View
                      style={{
                        borderRadius: 16,
                        backgroundColor: "rgba(255,255,255,0.08)",
                        padding: 12,
                      }}
                    >
                      {item.kind === "voice" ? (
                        <Pressable
                          onPress={() => handlePlayVoiceMessage(item)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <MaterialCommunityIcons
                            name={
                              playingMessageId === item.id
                                ? "pause-circle"
                                : "play-circle"
                            }
                            size={24}
                            color="#fff"
                          />
                          <Text
                            style={{ color: "#fff", fontFamily: fonts.poppins }}
                          >
                            Nota de voz {formatDuration(item.durationMs)}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text
                          style={{ color: "#fff", fontFamily: fonts.poppins }}
                        >
                          {item.body}
                        </Text>
                      )}
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.55)",
                          fontFamily: fonts.poppins,
                          fontSize: 12,
                          marginTop: 6,
                        }}
                      >
                        {item.user_uid || "anon"} -{" "}
                        {new Date(item.created_at).toLocaleTimeString("es-MX", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.7)",
                        fontFamily: fonts.poppins,
                      }}
                    >
                      {selectedRoom
                        ? "Todavia no hay mensajes en esta sala."
                        : "Selecciona una sala para empezar."}
                    </Text>
                  }
                />
              )}

              <View
                style={{ flexDirection: "row", gap: 10, marginTop: "auto" }}
              >
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Escribe un mensaje"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  editable={!submitting}
                  style={[inputStyle, { flex: 1, marginBottom: 0 }]}
                />
                <Pressable
                  onPress={handleSend}
                  disabled={submitting || !selectedRoom}
                  style={primaryButton}
                >
                  <MaterialCommunityIcons
                    name="send"
                    size={18}
                    color="#04131f"
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const inputStyle = {
  borderRadius: 16,
  paddingHorizontal: 14,
  paddingVertical: 12,
  backgroundColor: "rgba(8,15,30,0.85)",
  color: "#fff",
  fontFamily: fonts.poppins,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.12)",
} as const;

const primaryButton = {
  minHeight: 46,
  borderRadius: 16,
  backgroundColor: colors.brandBlue,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 18,
} as const;

const secondaryButton = {
  minHeight: 46,
  borderRadius: 16,
  backgroundColor: "rgba(255,255,255,0.08)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.12)",
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 18,
} as const;

const iconButton = {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(255,255,255,0.12)",
} as const;

const primaryButtonText = {
  color: "#04131f",
  fontFamily: fonts.poppinsSemiBold,
  fontSize: 15,
} as const;

const secondaryButtonText = {
  color: "#fff",
  fontFamily: fonts.poppinsSemiBold,
  fontSize: 15,
} as const;
