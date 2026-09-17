import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as Network from 'expo-network'

type NetworkContextValue = {
  isOnline: boolean
  /** Timestamp of the last online↔offline transition, or null if it never changed. */
  lastChangedAt: number | null
  /**
   * Runs `callback` each time connectivity is regained. Returns an unsubscribe fn.
   * Only fires on an offline→online TRANSITION — a listener registered while already
   * online is not called until the connection actually drops and comes back, so
   * anything that must also run on mount has to call it itself.
   */
  onReconnect: (callback: () => void) => () => void
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

// `isConnected` and `isInternetReachable` are both OPTIONAL (expo-network's
// NetworkState) and are `undefined` until the first native read resolves — Expo's own
// `useNetworkState` starts at `{}`. Treating `undefined` as offline would flash a
// "sin conexión" banner on every cold start, so only an explicit `false` counts as
// offline. Same idiom the SOS path already uses in app/map/index.tsx.
function isStateOnline(state: Network.NetworkState): boolean {
  return !(state.isConnected === false || state.isInternetReachable === false)
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [lastChangedAt, setLastChangedAt] = useState<number | null>(null)

  // Subscribers live in a ref, not state: registering one must not re-render the app,
  // and they are invoked from inside the native listener callback.
  const reconnectSubscribers = useRef(new Set<() => void>())
  // Mirrors `isOnline` for the listener, which is registered once and would otherwise
  // close over a stale value for the life of the app.
  const isOnlineRef = useRef(true)

  const applyState = useCallback((state: Network.NetworkState) => {
    const next = isStateOnline(state)
    if (next === isOnlineRef.current) return
    isOnlineRef.current = next
    setIsOnline(next)
    setLastChangedAt(Date.now())
    if (!next) return

    // Offline → online. Iterate a copy: a subscriber may unsubscribe itself, and one
    // throwing must not stop the others — a failed zone flush cannot be allowed to
    // skip the SOS flush queued behind it.
    for (const callback of Array.from(reconnectSubscribers.current)) {
      try {
        callback()
      } catch (error) {
        console.warn('[Network] onReconnect subscriber failed:', error)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    Network.getNetworkStateAsync()
      .then((state) => {
        if (!cancelled) applyState(state)
      })
      .catch(() => {
        // A failed read tells us nothing about connectivity — stay optimistic rather
        // than declaring the app offline because a native call misbehaved.
      })

    const subscription = Network.addNetworkStateListener(applyState)
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [applyState])

  const onReconnect = useCallback((callback: () => void) => {
    reconnectSubscribers.current.add(callback)
    return () => {
      reconnectSubscribers.current.delete(callback)
    }
  }, [])

  const value = useMemo(
    () => ({ isOnline, lastChangedAt, onReconnect }),
    [isOnline, lastChangedAt, onReconnect],
  )

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork() {
  const context = useContext(NetworkContext)
  if (!context) throw new Error('useNetwork must be used inside NetworkProvider')
  return context
}
