import type { LocalTransport } from "./transport";

/**
 * Platform-agnostic fallback. Metro resolves `NearbyTransport.android.ts` on
 * Android and `NearbyTransport.ios.ts` on iOS; this base file is the default
 * for any other platform AND — importantly — the runtime sibling expo-router
 * requires for the platform-specific files during a production export. Without
 * it, the release bundle throws "does not have a fallback sibling file without
 * a platform extension" and the whole router tree fails to mount.
 *
 * It reports unavailable so the UI shows a clear "not supported here" state.
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
