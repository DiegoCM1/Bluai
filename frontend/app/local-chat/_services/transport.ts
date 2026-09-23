import type { Peer, TransportState } from "../_types";
import { createNearbyTransport } from "./NearbyTransport";

export interface TransportHandlers {
  onStateChange: (state: TransportState) => void;
  onPeerFound: (peer: Peer) => void;
  onPeerLost: (endpointId: string) => void;
  onConnectionInitiated: (peer: Peer) => void;
  onConnected: (peer: Peer) => void;
  onConnectionFailed: (endpointId: string) => void;
  /** A connection was auto-rejected natively because the peer's deviceId is blocked. */
  onConnectionRejected: (peer: Peer) => void;
  onDisconnected: (endpointId: string) => void;
  /** Raw payload string from a peer. Caller decodes it (see protocol.ts). */
  onPayload: (endpointId: string, raw: string) => void;
}

/**
 * Platform-agnostic local peer-to-peer transport.
 * - Android → Google Nearby Connections.
 * - iOS → MultipeerConnectivity (future, same contract).
 *
 * Multi-peer by design (`send`/events are addressed by `endpointId`) so a
 * mesh routing layer can sit on top without changing this interface.
 */
export interface LocalTransport {
  readonly isAvailable: boolean;
  startAdvertising(displayName: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  requestConnection(endpointId: string): Promise<void>;
  /** Send a raw payload to a specific connected peer. */
  send(endpointId: string, raw: string): Promise<void>;
  /** Disconnect a specific peer, or all peers when omitted. */
  disconnect(endpointId?: string): Promise<void>;
  stopAll(): Promise<void>;
  /** Sync the full blocked-deviceId list down to the native layer, so a
   * blocked peer is rejected in onConnectionInitiated — before ever
   * accepting, no JS round trip needed. No-op on platforms without native
   * support for it (checked via best-effort try/catch by the caller). */
  setBlockedDeviceIds(deviceIds: string[]): Promise<void>;
  /** Subscribe to transport events. Returns an unsubscribe function. */
  subscribe(handlers: Partial<TransportHandlers>): () => void;
}

let instance: LocalTransport | null = null;

/** Returns the process-wide transport singleton for the current platform. */
export function getTransport(): LocalTransport {
  if (!instance) {
    instance = createNearbyTransport();
  }
  return instance;
}
