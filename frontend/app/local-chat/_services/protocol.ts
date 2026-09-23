/**
 * Wire format for a single message. Designed for mesh from day one:
 * - 1-to-1 sets `to` = the peer and `ttl` = 1.
 * - Multi-hop (future) sets `to` = BROADCAST or a peerId and decrements
 *   `ttl` on each relay, using `id` for de-duplication.
 *
 * Keeping this envelope now means the mesh router is purely additive later —
 * the transport and UI never learn about hops.
 */
/**
 * What a payload means:
 * - `text`     → a chat message (`body` is the text).
 * - `identity` → a live identity update (`body` is the sender's new nickname).
 * Control kinds ride the same wire path as text, typed by this field.
 */
export type MessageKind = "text" | "identity";

export interface Envelope {
  v: 1;
  id: string;
  from: string;
  to: string; // peerId | BROADCAST
  ttl: number;
  kind: MessageKind;
  body: string;
  ts: number;
}

export const BROADCAST = "*";

/**
 * Envelope ids are for dedup, not secrets — no need for a CSPRNG. Dependency-
 * free on purpose: `expo-crypto` requires its native module (unavailable
 * outside the RN app, e.g. the mesh router's in-memory test harness run
 * under plain Node via `tsx` — see meshRouter.harness.ts), and pulling it in
 * dragged react-native's Flow-syntax entry file into a plain esbuild
 * transform, which can't parse it.
 */
export function newId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function makeEnvelope(params: {
  from: string;
  to: string;
  body: string;
  ttl?: number;
  kind?: MessageKind;
}): Envelope {
  return {
    v: 1,
    id: newId(),
    from: params.from,
    to: params.to,
    ttl: params.ttl ?? 1,
    kind: params.kind ?? "text",
    body: params.body,
    ts: Date.now(),
  };
}

export function encode(envelope: Envelope): string {
  return JSON.stringify(envelope);
}

/**
 * Tolerant decode: accepts a JSON envelope, or falls back to treating the
 * raw string as a plain-text body (legacy / non-envelope sender). Returns
 * null only for empty payloads.
 */
export function decode(raw: string): Envelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && typeof parsed.body === "string") {
      // Coerce kind so older senders (no `kind`) are treated as text.
      const kind: MessageKind =
        parsed.kind === "identity" ? "identity" : "text";
      return { ...parsed, kind } as Envelope;
    }
  } catch {
    // Not JSON — fall through and treat as plain text.
  }

  if (raw.length > 0) {
    return {
      v: 1,
      id: newId(),
      from: "unknown",
      to: BROADCAST,
      ttl: 0,
      kind: "text",
      body: raw,
      ts: Date.now(),
    };
  }

  return null;
}
