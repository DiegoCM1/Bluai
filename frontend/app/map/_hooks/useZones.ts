import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner-native'

import { useNetwork } from '../../../features/network/NetworkContext'
import { MAP_EVENT_RADIUS_KM } from '../config'
import {
  MapHttpError,
  createZone,
  deleteZone,
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
  const { isOnline, onReconnect } = useNetwork()

  const [zones, setZones] = useState<Zone[]>([])
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // Guards the cache-priming effect against clobbering fresher network data that landed
  // first — on a warm start the fetch can beat AsyncStorage.
  const hasFreshData = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await getMapQueue()).length)
  }, [])

  // Reads straight from the cache, so it needs no coordinates.
  const reloadFromCache = useCallback(async () => {
    const cached = await readCachedZones()
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
      if (!active || hasFreshData.current) return
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

  // 2. Refresh from the network once we know where the user is.
  useEffect(() => {
    if (!userLocation) return
    let active = true
    ;(async () => {
      try {
        const fetched = await fetchZones({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        })
        if (!active) return
        // Merge rather than replace — see writeFetchedZones. Re-reading afterwards is
        // what keeps queued local reports on the map alongside the server's answer.
        await writeFetchedZones(fetched, userLocation, MAP_EVENT_RADIUS_KM)
        if (!active) return
        hasFreshData.current = true
        await reloadFromCache()
        setIsStale(false)
      } catch (error) {
        // Keep whatever the cache gave us and stay marked stale, so the UI can say so
        // instead of silently presenting old data as current.
        console.warn('[Map] Zone refresh failed, keeping cached zones:', error)
        if (active) setIsStale(true)
      }
    })()
    return () => {
      active = false
    }
  }, [userLocation, reloadFromCache])

  const applyFlushResult = useCallback(
    async (result: MapFlushResult) => {
      const touched =
        result.created.length +
        result.droppedCreates.length +
        result.updated.length +
        result.deleted.length
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
  useEffect(() => {
    flushQueue()
    return onReconnect(() => {
      flushQueue()
    })
  }, [flushQueue, onReconnect])

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

        await enqueueMapWrite({ kind: 'create', clientZoneId, zone: withAddress })
        await refreshPendingCount()
        toast.success('Reporte guardado', { description: OFFLINE_SAVE_DESCRIPTION })
      }
    },
    [refreshPendingCount],
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
    [getVoterLocation, refreshPendingCount],
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
    [refreshPendingCount],
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
    [refreshPendingCount],
  )

  return {
    zones,
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
