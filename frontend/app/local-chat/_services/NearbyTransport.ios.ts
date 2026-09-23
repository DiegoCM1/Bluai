import type { LocalTransport } from "./transport";

/**
 * iOS placeholder. Google Nearby Connections is Android-only; iOS will use
 * MultipeerConnectivity behind this same interface (future config plugin +
 * native module). Until then the transport reports unavailable so the UI can
 * show a clear "not yet on iOS" message instead of silently doing nothing.
 */
export function createNearbyTransport(): LocalTransport {
  return {
    isAvailable: false,
    async startAdvertising() {},
    async stopAdvertising() {},
    async startDiscovery() {},
    async stopDiscovery() {},
    async requestConnection() {},
    async send() {},
    async disconnect() {},
    async stopAll() {},
    async setBlockedDeviceIds() {},
    subscribe() {
      return () => {};
    },
  };
}
