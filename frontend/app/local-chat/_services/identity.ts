// Identity codec for the offline chat.
//
// With no backend, the only identity that exists between two phones is the one
// physically broadcast over the radio. Nearby gives us a single string we
// control at discovery time — the endpoint name — so we pack BOTH the stable
// device id and the mutable nickname into it: "<deviceId>|<nickname>".
//
// The discoverer splits it back apart: deviceId keys the conversation,
// nickname is just the display label.

import { randomUUID } from "expo-crypto";

import { getAuth } from "@react-native-firebase/auth";

import { readAccountName } from "../../../features/auth/accountName";
import { getStoredProfile } from "../../onboarding/_services/onboardingService";
import type { Identity } from "../_types";

const SEP = "|";

/** Nickname length bounds — enforced by NicknameModal and setNickname too. */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

/**
 * Pack identity into the single string the radio advertises.
 * The nickname can't contain the separator, so we strip it defensively.
 */
export function encodeIdentity(identity: Identity): string {
  const safeNickname = identity.nickname.replace(/\|/g, " ").trim();
  return `${identity.deviceId}${SEP}${safeNickname}`;
}

/**
 * Parse a broadcast endpoint name back into identity. Tolerant of legacy /
 * non-encoded names (no separator): treats the whole string as both id and
 * nickname so an older build still shows up as *something*.
 */
export function decodeIdentity(endpointName: string): Identity {
  const idx = endpointName.indexOf(SEP);
  if (idx === -1) {
    return { deviceId: endpointName, nickname: endpointName };
  }
  const deviceId = endpointName.slice(0, idx);
  const nickname = endpointName.slice(idx + 1) || deviceId;
  return { deviceId, nickname };
}

/**
 * Fit a name into NICKNAME_MAX by dropping whole trailing words, so
 * "Luis Diego Colín Mendiola" becomes "Luis Diego Colín", not "…Colín Men".
 * Hard-cuts only when the first word alone is too long.
 */
function fitName(name: string): string {
  const words = name.replace(/\|/g, " ").trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > NICKNAME_MAX) break;
    out = next;
  }
  return out || (words[0] ?? "").slice(0, NICKNAME_MAX);
}

/**
 * The chat nickname derived from the profile, so it matches "Mi perfil": the
 * onboarding first + last name wins, then the sign-in provider's full name
 * (same precedence as profile/index.tsx `fullName`). Read from the LOCAL
 * onboarding copy, not GET /users/me — this chat must work with no network.
 *
 * Note: this is broadcast in the clear to any phone in radio range, surnames
 * included — a deliberate product choice (names should match the profile).
 * Returns null when nothing usable exists (the nickname modal then asks).
 */
export async function nicknameFromProfile(): Promise<string | null> {
  const [stored, provider] = await Promise.all([
    getStoredProfile(),
    readAccountName(),
  ]);
  // Only trust the onboarding blob if THIS account wrote it — on a shared
  // phone it could still hold a previous user's name.
  const uid = getAuth().currentUser?.uid;
  const onboarding =
    uid && stored?.uid === uid
      ? [stored.data.firstName, stored.data.lastName]
          .map((s) => s?.trim())
          .filter(Boolean)
          .join(" ")
      : "";
  const fromProvider = [provider?.givenName, provider?.familyName]
    .filter(Boolean)
    .join(" ");

  const name = fitName(onboarding || fromProvider);
  return name.length >= NICKNAME_MIN ? name : null;
}

/**
 * Mint a new stable device id. 12 hex chars (~48 bits) is collision-safe for
 * any realistic local radius and keeps the broadcast name well under Nearby's
 * endpoint-name length budget.
 */
export function newDeviceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
