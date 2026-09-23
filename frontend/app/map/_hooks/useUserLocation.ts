import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

import { syncLocationToBackend } from '../../../utils/locationSync'

type Coords = { latitude: number; longitude: number }

type UseUserLocationOptions = {
  /**
   * Called whenever a position becomes available, so the caller can move the camera.
   * Held in a ref and invoked from a `[]` effect: that preserves the original run-once
   * behaviour while still reading current props at call time. The old inline effect
   * closed over focusLat/focusLon from mount, which only worked because the deps array
   * was (deliberately) wrong.
   */
  onPositionFixed?: (coords: Coords, isPrecise: boolean) => void
}

const FIX_TIMEOUT_MS = 15000
// A fix from the last five minutes is close enough to centre the map on while the
// precise one is still being acquired.
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000

export default function useUserLocation({ onPositionFixed }: UseUserLocationOptions = {}) {
  const [userLocation, setUserLocation] = useState<Coords | null>(null)
  const [currentCoords, setCurrentCoords] = useState<Coords | null>(null)

  const onPositionFixedRef = useRef(onPositionFixed)
  onPositionFixedRef.current = onPositionFixed

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let active = true

    const apply = (coords: Coords, isPrecise: boolean) => {
      if (!active) return
      setUserLocation(coords)
      setCurrentCoords(coords)
      onPositionFixedRef.current?.(coords, isPrecise)
    }

    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          console.warn('Location permission denied - using default region')
          return
        }

        // Seed from the OS cache first: it returns immediately and needs no satellite
        // fix, so the map — and the zone load that keys off userLocation — no longer
        // sits behind a cold GPS for up to 15s. That wait was why the map could render
        // completely empty indoors even with a populated cache.
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: LAST_KNOWN_MAX_AGE_MS,
          })
          if (lastKnown) {
            apply(
              { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude },
              false,
            )
          }
        } catch {
          // Best-effort only — the precise fix below is the real answer.
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Location timeout')), FIX_TIMEOUT_MS)
        })

        const { coords } = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          timeoutPromise,
        ])

        clearTimeout(timeoutId)
        if (!active) return

        apply({ latitude: coords.latitude, longitude: coords.longitude }, true)
        // Only the precise fix is worth reporting upstream; the cached seed may be stale.
        syncLocationToBackend(coords.latitude, coords.longitude)
      } catch (error) {
        console.warn(
          '⚠️ Could not get location (timeout or error), using default region:',
          error instanceof Error ? error.message : error,
        )
      }
    })()

    return () => {
      active = false
      if (timeoutId) clearTimeout(timeoutId)
    }
    // Run-once by design — see onPositionFixed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { userLocation, currentCoords }
}
