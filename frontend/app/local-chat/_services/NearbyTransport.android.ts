import { DeviceEventEmitter, NativeModules } from "react-native";

import type { TransportState } from "../_types";
import type { LocalTransport, TransportHandlers } from "./transport";

/** Bridge surface exposed by the generated native module (see
 * `plugins/with-nearby-connections.js`). */
type NativeNearby = {
  startAdvertising: (displayName?: string) => Promise<boolean>;
  stopAdvertising: () => Promise<boolean>;
  startDiscovery: () => Promise<boolean>;
  stopDiscovery: () => Promise<boolean>;
  requestConnection: (endpointId: string) => Promise<boolean>;
  /** Directed: targets one specific connected endpoint (P2P_CLUSTER holds several). */
  sendMessage: (endpointId: string, message: string) => Promise<boolean>;
  /** endpointId omitted → disconnect everyone. */
  disconnect: (endpointId?: string | null) => Promise<boolean>;
  stopAll: () => Promise<boolean>;
  setBlockedDeviceIds: (deviceIds: string[]) => Promise<boolean>;
};

const native = NativeModules.NearbyConnections as NativeNearby | undefined;

/**
 * Fail loud, not silent. Without this guard, `native?.method()` would resolve
 * as if the call succeeded when the native module isn't in the build — the UI
 * would show "advertising" while nothing is on the radio. Throwing surfaces a
 * clear, actionable error up through the hook's try/catch instead.
 */
function requireNative(): NativeNearby {
  if (!native) {
    throw new Error(
      "Módulo nativo NearbyConnections no disponible. Reconstruye con `expo run:android`.",
    );
  }
  return native;
}

/** Translate the native DeviceEventEmitter events into our handler shape. */
function bind(handlers: Partial<TransportHandlers>): () => void {
  const subs = [
    DeviceEventEmitter.addListener(
      "NearbyStateChanged",
      (e: { state?: string }) => {
        if (e.state) handlers.onStateChange?.(e.state as TransportState);
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyEndpointFound",
      (e: { endpointId?: string; endpointName?: string }) => {
        if (e.endpointId && e.endpointName) {
          handlers.onPeerFound?.({
            endpointId: e.endpointId,
            name: e.endpointName,
          });
        }
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyEndpointLost",
      (e: { endpointId?: string }) => {
        if (e.endpointId) handlers.onPeerLost?.(e.endpointId);
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyConnectionInitiated",
      (e: { endpointId?: string; endpointName?: string }) => {
        if (e.endpointId) {
          handlers.onConnectionInitiated?.({
            endpointId: e.endpointId,
            name: e.endpointName ?? e.endpointId,
          });
        }
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyConnectionConnected",
      (e: { endpointId?: string; endpointName?: string }) => {
        if (e.endpointId) {
          handlers.onConnected?.({
            endpointId: e.endpointId,
            name: e.endpointName ?? e.endpointId,
          });
        }
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyConnectionFailed",
      (e: { endpointId?: string }) => {
        handlers.onConnectionFailed?.(e.endpointId ?? "");
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyConnectionRejected",
      (e: { endpointId?: string; endpointName?: string }) => {
        if (e.endpointId) {
          handlers.onConnectionRejected?.({
            endpointId: e.endpointId,
            name: e.endpointName ?? e.endpointId,
          });
        }
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyDisconnected",
      (e: { endpointId?: string }) => {
        handlers.onDisconnected?.(e.endpointId ?? "");
      },
    ),
    DeviceEventEmitter.addListener(
      "NearbyMessageReceived",
      (e: { endpointId?: string; message?: string }) => {
        if (e.message) handlers.onPayload?.(e.endpointId ?? "", e.message);
      },
    ),
  ];

  return () => subs.forEach((s) => s.remove());
}

export function createNearbyTransport(): LocalTransport {
  return {
    isAvailable: Boolean(native),

    async startAdvertising(displayName: string) {
      await requireNative().startAdvertising(displayName);
    },

    async stopAdvertising() {
      await requireNative().stopAdvertising();
    },

    async startDiscovery() {
      await requireNative().startDiscovery();
    },

    async stopDiscovery() {
      await requireNative().stopDiscovery();
    },

    async requestConnection(endpointId: string) {
      await requireNative().requestConnection(endpointId);
    },

    async send(endpointId: string, raw: string) {
      await requireNative().sendMessage(endpointId, raw);
    },

    async disconnect(endpointId?: string) {
      await requireNative().disconnect(endpointId ?? null);
    },

    async stopAll() {
      await requireNative().stopAll();
    },

    async setBlockedDeviceIds(deviceIds: string[]) {
      await requireNative().setBlockedDeviceIds(deviceIds);
    },

    subscribe(handlers) {
      return bind(handlers);
    },
  };
}
