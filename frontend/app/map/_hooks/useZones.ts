import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { toast } from 'sonner-native'

import { useNetwork } from '../../../features/network/NetworkContext'
import { MAP_EVENT_RADIUS_KM, VOTING_DISTANCE_METERS } from '../config'
import {
  MapHttpError,
  createZone,
  deleteZone,
  distanceInMeters,
  fetchZones,
  generateZoneId,
  isUnreachable,
  reverseGeocodeAddress,
  updateZone,
  voteZone,
} from '../service'
import {
  enqueueMapWrite,
  flushMapQueue,
  getMapQueue,
  type MapFlushResult,
} from '../_services/mapQueue'
import { readCachedZones, removeCachedZone, upsertCachedZone, writeFetchedZones } from '../_services/zoneCache'
import type { Zone, ZoneType } from '../types'

type Coords = { latitude: number; longitude: number }

type UseZonesOptions = {
  /** Where to centre the fetch. Null until GPS resolves; the cache loads without it. */
  userLocation: Coords | null
  /** Resolved lazily so voting never has to reach into map-camera state. */
  getVoterLocation: () => Coords | null
}

const OFFLINE_SAVE_DESCRIPTION = 'Se enviará cuando recuperes conexión.'

// Below this, a new GPS reading is treated as the same place and does not trigger a
// refetch. The display radius is 100 km, so a few hundred metres changes nothing.
const REFETCH_MIN_MOVE_METERS = 500

// The backend distinguishes five vote failures (map_events/service.py). The map used to
// show "debes estar cerca del evento" for all of them — and for network errors too.
function voteErrorMessage(error: MapHttpError, value: 1 | -1): string {
  const detail = error.message.toLowerCase()
  if (error.status === 403 && detail.includes('own event')) {
    return 'No puedes votar tu propio reporte.'
  }
  if (error.status === 403) {
    return value === 1
      ? 'Debes estar cerca del evento para confirmarlo.'
      : 'Debes estar cerca del evento para marcarlo como engañoso.'
  }
  if (error.status === 409) return 'Ya votaste este reporte.'
  if (error.status === 404) return 'Este reporte ya no existe.'
  if (error.status === 401) return 'Inicia sesión para votar.'
  return 'Intenta de nuevo en un momento.'
}

export default function useZones({ userLocation, getVoterLocation }: UseZonesOptions) {
  const { isOnline, onReconnect, reportReachability } = useNetwork()

  const [zones, setZones] = useState<Zone[]>([])
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // Guards the cache-priming effect against clobbering fresher network data that landed
  // first — on a warm start the fetch can beat AsyncStorage.
  const hasFreshData = useRef(false)
  // Read inside refreshZones so reconnecting can refetch without the callback identity
  // depending on userLocation (which would resubscribe the reconnect listener on every
  // GPS update).
  const userLocationRef = useRef(userLocation)
  userLocationRef.current = userLocation
  const lastFetchCenter = useRef<Coords | null>(null)
  const isMountedRef = useRef(true)
  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getMapQueue()).length)
  }, [])

  // Reads straight from the cache, so it needs no coordinates.
  const reloadFromCache = useCallback(async () => {
    const cached = await readCachedZones()
    console.log(`[Zones] state <- cache: ${cached.length} zones`)
    setZones(cached)
    return cached
  }, [])

  // 1. Cache first, on mount, with NO GPS gate. This is the fix for an empty map when
  //    the 15s location race times out or permission is denied: previously the only path
  //    to the cache ran inside the fetch, which only ran once userLocation existed.
  useEffect(() => {
    let active = true
    ;(async () => {
      const cached = await readCachedZones()
      if (!active || hasFreshData.current) {
        console.log(
          `[Zones] cache prime SKIPPED (active=${active}, hasFreshData=${hasFreshData.current}) — ${cached.length} cached zones not applied`,
        )
        return
      }
      console.log(`[Zones] cache primed with ${cached.length} zones`)
      if (cached.length > 0) {
        setZones(cached)
        setIsStale(true)
      }
      await refreshPendingCount()
    })()
    return () => {
      active = false
    }
  }, [refreshPendingCount])

  // 2. Refresh from the network. Callable from anywhere — not just when userLocation
  //    changes — because regaining connectivity has to be able to trigger it too.
  const refreshZones = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const location = userLocationRef.current
      if (!location) return

      // GPS reports twice on startup (cached seed, then precise fix), usually metres
      // apart. Without this guard that is two full 100 km fetches on every launch.
      const previous = lastFetchCenter.current
      if (
        !force &&
        previous &&
        distanceInMeters(
          previous.latitude,
          previous.longitude,
          location.latitude,
          location.longitude,
        ) < REFETCH_MIN_MOVE_METERS
      ) {
        return
      }

      try {
        const fetched = await fetchZones({
          latitude: location.latitude,
          longitude: location.longitude,
        })
        // Merge rather than replace — see writeFetchedZones. Re-reading afterwards is
        // what keeps queued local reports on the map alongside the server's answer.
        await writeFetchedZones(fetched, location, MAP_EVENT_RADIUS_KM)
        // Only recorded on success, so a failed fetch is always retried.
        lastFetchCenter.current = location
        // A response arrived: definitively online, whatever the native flags claim.
        reportReachability(true)
        if (!isMountedRef.current) return
        hasFreshData.current = true
        await reloadFromCache()
        setIsStale(false)
      } catch (error) {
        // Keep whatever the cache gave us and stay marked stale, so the UI can say so
        // instead of silently presenting old data as current.
        console.warn(
          `[Zones] refresh FAILED (unreachable=${isUnreachable(error)}, status=${
            error instanceof MapHttpError ? error.status : 'n/a'
          }): ${error instanceof Error ? error.message : String(error)}`,
        )
        if (isUnreachable(error)) reportReachability(false)
        if (isMountedRef.current) setIsStale(true)
      }
    },
    [reloadFromCache, reportReachability],
  )

  useEffect(() => {
    if (!userLocation) return
    refreshZones()
  }, [userLocation, refreshZones])

  const applyFlushResult = useCallback(
    async (result: MapFlushResult) => {
      const touched =
        result.created.length +
        result.droppedCreates.length +
        result.updated.length +
        result.deleted.length
      console.log(
        `[Zones] flush: ${result.created.length} created, ${result.droppedCreates.length} dropped, ${result.updated.length} updated, ${result.deleted.length} deleted, ${result.remaining} still queued`,
      )
      if (touched === 0) {
        setPendingCount(result.remaining)
        return
      }

      for (const { clientZoneId } of result.created) await removeCachedZone(clientZoneId)
      for (const { zone } of result.created) await upsertCachedZone(zone)
      for (const clientZoneId of result.droppedCreates) await removeCachedZone(clientZoneId)
      for (const zone of result.updated) await upsertCachedZone(zone)
      for (const id of result.deleted) await removeCachedZone(id)

      await reloadFromCache()
      setPendingCount(result.remaining)

      if (result.created.length > 0) {
        toast.success('Reportes sincronizados', {
          description: `${result.created.length} reporte(s) enviado(s).`,
        })
      }
      if (result.droppedCreates.length > 0) {
        toast.error('Reporte no enviado', {
          description: 'El servidor rechazó un reporte guardado. Se eliminó del mapa.',
        })
      }
    },
    [reloadFromCache],
  )

  const flushQueue = useCallback(async () => {
    applyFlushResult(await flushMapQueue())
  }, [applyFlushResult])

  // 3. Flush on mount (covers launching online with a queue from a previous session)
  //    and on every reconnect — the latter is new: until now the only triggers were
  //    screen focus and app foregrounding, so a user watching the map as signal returned
  //    kept an undelivered report indefinitely.
  const recoverNow = useCallback(async () => {
    // Order matters: push our queued writes first, THEN refetch, so the response already
    // contains them and cannot momentarily contradict what is on screen. The refetch is
    // forced — the user has not moved, but the data is stale by virtue of the outage,
    // which is exactly the case the distance guard would otherwise skip.
    await flushQueue()
    await refreshZones({ force: true })
  }, [flushQueue, refreshZones])

  // Subscription only — no call on mount, because the focus effect below already fires
  // on first focus and a forced refresh here would duplicate its fetch.
  useEffect(
    () =>
      onReconnect(() => {
        recoverNow()
      }),
    [recoverNow, onReconnect],
  )

  // Second trigger, on purpose. The reconnect edge is the fast path but it is not
  // reliable on its own: if the OFFLINE edge is ever missed, the recovery stops being a
  // transition and onReconnect never fires at all, stranding queued writes with no
  // retry. Re-checking on focus is how sosQueue has always worked, and it means a
  // missed edge costs a screen visit rather than the whole recovery path.
  useFocusEffect(
    useCallback(() => {
      recoverNow()
    }, [recoverNow]),
  )

  const selectZone = useCallback((zone: Zone | null) => setSelectedZone(zone), [])

  const createReport = useCallback(
    async (input: { latitude: number; longitude: number; description: string; type: ZoneType }) => {
      const clientZoneId = generateZoneId()
      const reportedAt = new Date().toISOString()
      const optimistic: Zone = {
        id: clientZoneId,
        clientId: clientZoneId,
        latitude: input.latitude,
        longitude: input.longitude,
        description: input.description,
        timestamp: reportedAt,
        reportedAt,
        radius: 500,
        type: input.type,
        isOwner: true,
        pending: true,
      }

      // Persist BEFORE any network work. The old code held the optimistic zone in React
      // state only and deleted it on failure, so an offline report — or one interrupted
      // by the app being killed during the 5s geocode — was gone for good.
      setZones((prev) => [...prev, optimistic])
      await upsertCachedZone(optimistic)

      const address = await reverseGeocodeAddress(input.latitude, input.longitude)
      const withAddress: Zone = { ...optimistic, address: address ?? null }
      if (address) {
        setZones((prev) => prev.map((z) => (z.id === clientZoneId ? withAddress : z)))
        await upsertCachedZone(withAddress)
      }

      try {
        const saved = await createZone(withAddress)
        await removeCachedZone(clientZoneId)
        await upsertCachedZone(saved)
        setZones((prev) => prev.map((z) => (z.id === clientZoneId ? saved : z)))
        toast.success('Zona reportada', { description: 'Gracias por tu reporte' })
        return
      } catch (error) {
        if (error instanceof MapHttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          // The server refused the report itself — queueing would replay a request that
          // can never succeed. This is the only case where the marker is removed.
          console.error('[Map] Report rejected by server:', error)
          await removeCachedZone(clientZoneId)
          setZones((prev) => prev.filter((z) => z.id !== clientZoneId))
          toast.error('Error al guardar', { description: 'No se pudo guardar la zona' })
          return
        }

        reportReachability(false)
        await enqueueMapWrite({ kind: 'create', clientZoneId, zone: withAddress })
        await refreshPendingCount()
        toast.success('Reporte guardado', { description: OFFLINE_SAVE_DESCRIPTION })
      }
    },
    [refreshPendingCount, reportReachability],
  )

  const voteOnZone = useCallback(
    async (zoneId: string, value: 1 | -1) => {
      const voter = getVoterLocation()
      if (!voter) {
        toast.error('Ubicación requerida', {
          description: 'Necesitamos tu ubicación para registrar el voto.',
        })
        return
      }

      try {
        const voted = await voteZone(zoneId, value, voter)
        setZones((prev) => prev.map((z) => (z.id === voted.id ? voted : z)))
        setSelectedZone((prev) => (prev && prev.id === voted.id ? voted : prev))
        await upsertCachedZone(voted)
        toast.success(value === 1 ? 'Evento confirmado' : 'Evento marcado como engañoso', {
          description: 'Tu voto se registró correctamente',
        })
      } catch (error) {
        if (isUnreachable(error)) {
          reportReachability(false)
          await enqueueMapWrite({
            kind: 'vote',
            zoneId,
            value,
            lat: voter.latitude,
            lon: voter.longitude,
          })
          await refreshPendingCount()
          toast.success('Voto guardado', { description: OFFLINE_SAVE_DESCRIPTION })
          return
        }
        console.error('[Map] Failed to vote zone:', error)
        toast.error('No se pudo votar', {
          description: voteErrorMessage(error as MapHttpError, value),
        })
      }
    },
    [getVoterLocation, refreshPendingCount, reportReachability],
  )

  const editZone = useCallback(
    async (zone: Zone, description: string) => {
      const trimmed = description.trim()
      if (!trimmed) return
      const previous = zone
      const updated: Zone = { ...zone, description: trimmed }

      setZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)))
      setSelectedZone(updated)

      try {
        const saved = await updateZone(updated)
        setZones((prev) => prev.map((z) => (z.id === saved.id ? saved : z)))
        setSelectedZone((prev) => (prev && prev.id === saved.id ? saved : prev))
        await upsertCachedZone(saved)
      } catch (error) {
        if (isUnreachable(error)) {
          reportReachability(false)
          await upsertCachedZone(updated)
          await enqueueMapWrite({ kind: 'update', zoneId: zone.id, description: trimmed })
          await refreshPendingCount()
          toast.success('Cambio guardado', { description: OFFLINE_SAVE_DESCRIPTION })
          return
        }
        // Restore the pre-edit snapshot captured above, matching the original rollback.
        console.error('[Map] Failed to update zone:', error)
        setZones((prev) => prev.map((z) => (z.id === previous.id ? previous : z)))
        setSelectedZone(previous)
        toast.error('Error al editar', { description: 'No se pudo guardar el cambio' })
      }
    },
    [refreshPendingCount, reportReachability],
  )

  const removeZone = useCallback(
    async (zone: Zone) => {
      const deleted = zone
      setZones((prev) => prev.filter((z) => z.id !== deleted.id))

      try {
        await deleteZone(deleted.id)
        await removeCachedZone(deleted.id)
      } catch (error) {
        if (isUnreachable(error)) {
          reportReachability(false)
          await removeCachedZone(deleted.id)
          await enqueueMapWrite({ kind: 'delete', zoneId: deleted.id })
          await refreshPendingCount()
          toast.success('Eliminación guardada', { description: OFFLINE_SAVE_DESCRIPTION })
          return
        }
        console.error('[Map] Failed to delete zone:', error)
        setZones((prev) => [...prev, deleted])
        toast.error('Error al eliminar', { description: 'No se pudo eliminar la zona' })
      }
    },
    [refreshPendingCount, reportReachability],
  )

  // `canVote`, `withinVotingRadius` and `distanceKm` are computed BY THE SERVER, for the
  // position and moment of the request. Served from cache they can be hours old and
  // kilometres wrong, yet the detail modal renders them as fact — enabling a vote that
  // will be rejected, or greying out one that would now succeed.
  //
  // Everything needed to recompute them is on the device: the zone's coordinates, the
  // user's current position, and the same 10 km radius the backend enforces. Only done
  // while stale; a fresh response is always authoritative.
  const resolvedZones = useMemo(() => {
    if (!isStale || !userLocation) return zones
    return zones.map((zone) => {
      // A pending report is the user's own and was never voteable anyway.
      if (zone.pending) return zone
      const meters = distanceInMeters(
        zone.latitude,
        zone.longitude,
        userLocation.latitude,
        userLocation.longitude,
      )
      const within = meters <= VOTING_DISTANCE_METERS
      return {
        ...zone,
        distanceKm: meters / 1000,
        withinVotingRadius: within,
        // The server also refuses votes on your own event, and isOwner is stable, so
        // this stays correct offline.
        canVote: within && !zone.isOwner,
      }
    })
  }, [zones, isStale, userLocation])

  return {
    zones: resolvedZones,
    isStale: isStale || !isOnline,
    pendingCount,
    selectedZone,
    selectZone,
    createReport,
    voteOnZone,
    editZone,
    removeZone,
    flushQueue,
  }
}
