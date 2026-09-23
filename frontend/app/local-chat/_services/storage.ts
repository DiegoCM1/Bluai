// Local-only persistence for the offline chat.
//
// The spec asks for MMKV; MMKV isn't installed in this project, so we use
// AsyncStorage with the SAME key shape (`bt:*`). If MMKV lands later, only
// this file changes — callers see the same async API.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Conversation } from "../_types";

const KEYS = {
  deviceId: "bt:self_id",
  nickname: "bt:nickname",
  conversations: "bt:conversations",
  // Keyed by deviceId, not nickname: nicknames are free-text (2-20 chars,
  // see NicknameModal) and a rename would otherwise evade a block — deviceId
  // is the one stable identity a peer can't change mid-session.
  blocked: "bt:blocked_device_ids",
} as const;

/** Load the persisted device id, or create + persist one on first run. */
export async function loadOrCreateDeviceId(
  create: () => string,
): Promise<string> {
  const existing = await AsyncStorage.getItem(KEYS.deviceId);
  if (existing) return existing;
  const id = create();
  await AsyncStorage.setItem(KEYS.deviceId, id);
  return id;
}

export async function loadNickname(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.nickname);
}

export async function saveNickname(nickname: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.nickname, nickname);
}

export async function loadConversations(): Promise<
  Record<string, Conversation>
> {
  const raw = await AsyncStorage.getItem(KEYS.conversations);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, Conversation>;
  } catch {
    // Corrupt blob — start clean rather than crash the screen.
    return {};
  }
}

export async function saveConversations(
  conversations: Record<string, Conversation>,
): Promise<void> {
  await AsyncStorage.setItem(KEYS.conversations, JSON.stringify(conversations));
}

/** Blocked peer deviceIds — not nicknames, which a peer can change at will. */
export async function loadBlockedDeviceIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.blocked);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function saveBlockedDeviceIds(deviceIds: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.blocked, JSON.stringify(deviceIds));
}
