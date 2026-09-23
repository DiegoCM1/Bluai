// Mesh routing layer — managed flooding over the existing Envelope wire format.
// Pure functions/state only: no Nearby, no React, no transport. This is what
// makes it testable without hardware (see meshRouter.harness.ts).
//
// Algorithm (see docs/specs_july05/val_sprint_3.md — do not redesign):
//   1. TTL: each hop decrements ttl by 1; ttl<=0 is not relayed further.
//   2. Dedup by envelope `id`: an id already seen is ignored (not delivered,
//      not relayed) — without this a message multiplies exponentially.
//   3. Split horizon: never relay back to the peer that gave us the payload.
//
// `myDeviceId` (stable) drives routing decisions, never `endpointId`
// (ephemeral, transport-local) — see protocol.ts / _types.ts.

import { BROADCAST, decode, encode, makeEnvelope } from "./protocol";
import type { Envelope, MessageKind } from "./protocol";

/** TTL for a fresh mesh broadcast. A dial, not a hardcoded literal in three places. */
export const MESH_DEFAULT_TTL = 6;

/** Dedup cache capacity. Bounded on purpose — an unbounded Set is a memory
 * leak in a long-running session (same class of bug as the MapMarkers
 * incident this spec calls out). ~500 covers emergency-mesh traffic easily. */
const SEEN_CAPACITY = 500;

/** Bounded id cache: O(1) has/add, evicts the oldest id once full (ring buffer). */
class SeenCache {
  private readonly order: string[] = [];
  private readonly ids = new Set<string>();
  constructor(private readonly capacity: number) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.ids.delete(evicted);
    }
  }

  get size(): number {
    return this.ids.size;
  }
}

export interface MeshRouterCallbacks {
  /**
   * Flood a raw payload to every directly-connected peer, except the one
   * identified by `exceptPeerHandle` when given (split horizon on relay).
   * `peerHandle` is whatever the caller uses to identify a direct link —
   * `endpointId` in production, a simulated node id in the test harness.
   */
  sendToAllExcept: (raw: string, exceptPeerHandle?: string) => void;
  /** Called once per envelope addressed to me or to BROADCAST, after dedup. */
  onDeliver: (envelope: Envelope, fromPeerHandle: string) => void;
}

export interface MeshRouter {
  /** Feed a raw payload received from a specific direct peer. */
  onPayload: (fromPeerHandle: string, raw: string) => void;
  /** Compose a brand-new message from this device and flood it. */
  send: (
    body: string,
    opts?: { to?: string; ttl?: number; kind?: MessageKind },
  ) => Envelope;
  /** Test/debug hook — number of ids currently held in the dedup cache. */
  seenCount: () => number;
}

export function createMeshRouter(
  myDeviceId: string,
  callbacks: MeshRouterCallbacks,
  opts?: { seenCapacity?: number },
): MeshRouter {
  const seen = new SeenCache(opts?.seenCapacity ?? SEEN_CAPACITY);

  function onPayload(fromPeerHandle: string, raw: string): void {
    const env = decode(raw);
    if (!env) return;
    if (seen.has(env.id)) return; // 1. dedup — already saw this id, drop it
    seen.add(env.id);

    // 2. Is it for me? (directly or broadcast) — deliver to the UI.
    if (env.to === myDeviceId || env.to === BROADCAST) {
      callbacks.onDeliver(env, fromPeerHandle);
    }

    // 3. Relay? TTL still has hops left, and it wasn't exclusively for me.
    if (env.ttl > 1 && env.to !== myDeviceId) {
      const relayed: Envelope = { ...env, ttl: env.ttl - 1 };
      callbacks.sendToAllExcept(encode(relayed), fromPeerHandle); // split horizon
    }
  }

  function send(
    body: string,
    sendOpts?: { to?: string; ttl?: number; kind?: MessageKind },
  ): Envelope {
    const env = makeEnvelope({
      from: myDeviceId,
      to: sendOpts?.to ?? BROADCAST,
      body,
      ttl: sendOpts?.ttl ?? MESH_DEFAULT_TTL,
      kind: sendOpts?.kind,
    });
    // Mark our own message as seen before it ever leaves: if a peer bounces
    // it back (or split horizon were ever implemented wrong), we must treat
    // it as already-seen, not as new — otherwise an infinite echo.
    seen.add(env.id);
    callbacks.sendToAllExcept(encode(env));
    return env;
  }

  return {
    onPayload,
    send,
    seenCount: () => seen.size,
  };
}
