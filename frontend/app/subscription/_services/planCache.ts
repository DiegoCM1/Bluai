import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAuth } from "@react-native-firebase/auth";

import type { PlanSlug } from "../_utils/planAccess";

/**
 * Last plan the server confirmed, so gates keep working with no network.
 *
 * Why: useCurrentPlan used to fall back to 'free' on ANY fetch failure. The
 * offline Bluetooth chat is gated on the plan and exists for exactly the moment
 * there is no internet — so a paying user lost it the instant the network died.
 *
 * Only a successful server response changes the cached value; a failed request
 * never downgrades it. Scoped by Firebase uid so another account signing in on
 * the same phone never inherits someone else's plan.
 */
const KEY = "@bluai_last_plan_v1";

interface CachedPlan {
  uid: string;
  plan: PlanSlug;
}

// In-memory copy: screens mounted after the first read start with the right
// plan synchronously instead of flashing the 'free' paywall for a frame.
let memory: CachedPlan | null = null;

function currentUid(): string | null {
  return getAuth().currentUser?.uid ?? null;
}

/** Synchronous best guess for the signed-in user, or null if not loaded yet. */
export function peekCachedPlan(): PlanSlug | null {
  const uid = currentUid();
  return uid && memory?.uid === uid ? memory.plan : null;
}

/** The cached plan for the signed-in user, or null. Never throws. */
export async function readCachedPlan(): Promise<PlanSlug | null> {
  const uid = currentUid();
  if (!uid) return null;
  if (memory?.uid === uid) return memory.plan;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CachedPlan>) : null;
    if (parsed?.uid !== uid || typeof parsed.plan !== "string") return null;
    memory = { uid, plan: parsed.plan as PlanSlug };
    return memory.plan;
  } catch {
    return null;
  }
}

/** Record a server-confirmed plan. Never throws. */
export async function writeCachedPlan(plan: PlanSlug): Promise<void> {
  const uid = currentUid();
  if (!uid) return;
  memory = { uid, plan };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // In-memory copy still covers this session.
  }
}
