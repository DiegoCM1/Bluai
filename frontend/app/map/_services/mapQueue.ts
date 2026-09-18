import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  createZone,
  deleteZone,
  isPermanentRejection,
  isUnreachable,
  updateZone,
  voteZone,
} from '../service'
import type { Zone } from '../types'

const QUEUE_KEY = '@BluEye:map_write_queue'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Same guard as sosQueue: screen focus, app foregrounding and the reconnect listener can
// all fire a flush within milliseconds of each other, and replaying a create twice would
// post the same hazard to the map twice.
let isFlushingMapQueue = false

export type MapQueueItem =
  | { kind: 'create'; id: string; queuedAt: number; clientZoneId: string; zone: Zone }
  | {
      kind: 'vote'
      id: string
      queuedAt: number
      zoneId: string
      value: 1 | -1
      lat: number
      lon: number
    }
  | { kind: 'update'; id: string; queuedAt: number; zoneId: string; description: string }
  | { kind: 'delete'; id: string; queuedAt: number; zoneId: string }

export type MapFlushResult = {
  /** Reports that reached the server. `clientZoneId` identifies the local marker to swap. */
  created: { clientZoneId: string; zone: Zone }[]
  /** Reports the server permanently rejected — their local markers must be removed. */
  droppedCreates: string[]
  /** Zones returned by a successful vote or edit. */
  updated: Zone[]
  /** Zone ids successfully deleted. */
  deleted: string[]
  /** Items still queued after this pass. */
  remaining: number
}

const EMPTY_RESULT: MapFlushResult = {
  created: [],
  droppedCreates: [],
  updated: [],
  deleted: [],
  remaining: 0,
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function readQueue(): Promise<MapQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const items: MapQueueItem[] = JSON.parse(raw)
    if (!Array.isArray(items)) return []
    const now = Date.now()
    return items.filter((item) => now - item.queuedAt < MAX_AGE_MS)
  } catch {
    return []
  }
}

async function writeQueue(items: MapQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

/**
 * Append a write. Unlike sosQueue — which keeps only the latest SOS, because an old
 * position is worse than none — every map write is kept: they are independent facts
 * about different places, and order matters (an edit must follow its create).
 */
export async function enqueueMapWrite(
  item:
    | { kind: 'create'; clientZoneId: string; zone: Zone }
    | { kind: 'vote'; zoneId: string; value: 1 | -1; lat: number; lon: number }
    | { kind: 'update'; zoneId: string; description: string }
    | { kind: 'delete'; zoneId: string },
): Promise<void> {
  const queue = await readQueue()
  queue.push({ ...item, id: newId(), queuedAt: Date.now() } as MapQueueItem)
  await writeQueue(queue)
}

export async function getMapQueue(): Promise<MapQueueItem[]> {
  return readQueue()
}

export async function hasPendingMapWrites(): Promise<boolean> {
  return (await readQueue()).length > 0
}

export async function clearMapQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY)
}

/**
 * Replay queued writes in order.
 *
 * Retry policy matches sosQueue: 429 and 5xx and unreachable stay queued, other 4xx are
 * dropped as unfixable. Deliberately emits no toasts — the caller owns user-facing
 * messaging, so a flush triggered while the map is unmounted stays silent.
 *
 * Ordering is load-bearing. A queued vote/edit/delete may target a report that is itself
 * still queued, and whose real id does not exist yet:
 *   - create succeeds → its dependents are rewritten to the server id and proceed
 *   - create stays queued → its dependents stay queued too, or they would 404
 *   - create is rejected → its dependents are dropped, since their target will never exist
 */
export async function flushMapQueue(): Promise<MapFlushResult> {
  if (isFlushingMapQueue) return EMPTY_RESULT
  isFlushingMapQueue = true

  try {
    const items = await readQueue()
    if (items.length === 0) return EMPTY_RESULT

    const result: MapFlushResult = {
      created: [],
      droppedCreates: [],
      updated: [],
      deleted: [],
      remaining: 0,
    }

    const survivors: MapQueueItem[] = []
    const idRemap = new Map<string, string>()
    const deferred = new Set<string>()
    const abandoned = new Set<string>()
    // Once one request proves the network is gone, stop attempting the rest: every
    // remaining call would burn its own timeout to reach the same conclusion.
    let networkDown = false

    for (const item of items) {
      if (item.kind !== 'create') {
        if (abandoned.has(item.zoneId)) continue
        if (deferred.has(item.zoneId)) {
          survivors.push(item)
          continue
        }
      }

      if (networkDown) {
        survivors.push(item)
        if (item.kind === 'create') deferred.add(item.clientZoneId)
        continue
      }

      try {
        if (item.kind === 'create') {
          const saved = await createZone(item.zone)
          idRemap.set(item.clientZoneId, saved.id)
          result.created.push({ clientZoneId: item.clientZoneId, zone: saved })
        } else {
          const zoneId = idRemap.get(item.zoneId) ?? item.zoneId
          if (item.kind === 'vote') {
            result.updated.push(
              await voteZone(zoneId, item.value, { latitude: item.lat, longitude: item.lon }),
            )
          } else if (item.kind === 'update') {
            result.updated.push(
              await updateZone({ id: zoneId, description: item.description }),
            )
          } else {
            await deleteZone(zoneId)
            result.deleted.push(zoneId)
          }
        }
      } catch (error) {
        if (isPermanentRejection(error)) {
          console.warn('[Map] Dropping unreplayable queued write:', item.kind, error)
          if (item.kind === 'create') {
            result.droppedCreates.push(item.clientZoneId)
            abandoned.add(item.clientZoneId)
          }
          continue
        }

        if (isUnreachable(error)) networkDown = true
        survivors.push(item)
        if (item.kind === 'create') deferred.add(item.clientZoneId)
      }
    }

    await writeQueue(survivors)
    result.remaining = survivors.length
    return result
  } finally {
    isFlushingMapQueue = false
  }
}
