import AsyncStorage from '@react-native-async-storage/async-storage'

import { ZONE_TYPES } from '../config'
import { distanceInMeters, normalizeZone } from '../service'
import type { Zone } from '../types'

// New key, deliberately not the old '@BluEye:redZones'. The stored shape changes here
// (entries carry `cachedAt`, pending writes now live alongside server data), and the old
// cache was a single global snapshot that a fetch in a new area silently replaced — the
// bug this module exists to fix. Nothing else in the app reads the old key, so it is left
// to rot rather than migrated: one stale snapshot is not worth a migration path.
const STORAGE_KEY = '@BluEye:map_zones_v2'

// Server-confirmed events are kept a week. Long enough to still have your own city
// cached after a few days offline, short enough that a resolved hazard does not haunt
// the map forever.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Un-synced local reports expire with the write queue's own 24h TTL. Without this a
// report whose queue entry was dropped would leave a marker on the map that no longer
// corresponds to anything, local or remote.
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000

// Bounded so a user who travels a lot cannot grow this without limit. Eviction is
// oldest-first and never touches pending writes.
const MAX_ENTRIES = 500

type CachedZone = Zone & { cachedAt: number }

function isUsable(zone: Partial<CachedZone> | null | undefined): boolean {
  if (!zone) return false
  if (typeof zone.id !== 'string' || zone.id.length === 0) return false
  if (!Number.isFinite(zone.latitude) || !Number.isFinite(zone.longitude)) return false
  if (!zone.type || !ZONE_TYPES[zone.type]) return false
  return true
}

function isExpired(zone: CachedZone, now: number): boolean {
  const age = now - (zone.cachedAt ?? 0)
  return zone.pending ? age > MAX_PENDING_AGE_MS : age > MAX_AGE_MS
}

async function readRaw(): Promise<CachedZone[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY)
    const parsed = data ? JSON.parse(data) : []
    if (!Array.isArray(parsed)) return []

    const now = Date.now()
    const usable = parsed.filter(isUsable)
    if (usable.length !== parsed.length) {
      console.warn(
        `[MapCache] dropped ${parsed.length - usable.length} unusable entr(ies) of ${parsed.length}`,
        parsed
          .filter((e: CachedZone) => !isUsable(e))
          .map((e: CachedZone) => ({
            id: e?.id,
            type: e?.type,
            lat: e?.latitude,
            lon: e?.longitude,
            pending: e?.pending,
          })),
      )
    }
    return usable
      .map((entry: CachedZone) => ({
        // Re-normalize on every read. Entries were written as plain JSON by whatever
        // version of the app stored them, so field-for-field they may not match the
        // current Zone contract — previously these went straight into <Marker>.
        ...normalizeZone({
          id: entry.id,
          type: entry.type,
          description: entry.description,
          lat: entry.latitude,
          lon: entry.longitude,
          address: entry.address,
          created_at: entry.timestamp,
          upvotes: entry.upvotes,
          downvotes: entry.downvotes,
          user_vote: entry.userVote,
          is_owner: entry.isOwner,
          distance_km: entry.distanceKm,
          within_voting_radius: entry.withinVotingRadius,
          can_vote: entry.canVote,
          trust_status: entry.trustStatus,
        }),
        // Local-only fields normalizeZone knows nothing about.
        pending: entry.pending,
        clientId: entry.clientId,
        reportedAt: entry.reportedAt,
        cachedAt: entry.cachedAt ?? now,
      }))
      .filter((zone) => {
        if (!isExpired(zone, now)) return true
        console.warn(
          `[MapCache] evicted expired zone ${zone.id} (pending=${!!zone.pending}, age=${Math.round(
            (now - (zone.cachedAt ?? 0)) / 1000,
          )}s)`,
        )
        return false
      })
  } catch (error) {
    console.error('[MapCache] read failed, returning empty:', error)
    return []
  }
}

async function writeRaw(zones: CachedZone[]): Promise<void> {
  try {
    let next = zones
    if (next.length > MAX_ENTRIES) {
      // Never evict a pending write to make room for server data — it is the only copy.
      const pending = next.filter((z) => z.pending)
      const confirmed = next
        .filter((z) => !z.pending)
        .sort((a, b) => b.cachedAt - a.cachedAt)
        .slice(0, Math.max(0, MAX_ENTRIES - pending.length))
      next = [...pending, ...confirmed]
    }
    console.log(
      `[MapCache] write ${next.length} zones (${next.filter((z) => z.pending).length} pending)`,
    )
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    console.error('[MapCache] write FAILED — zones may be lost:', error)
  }
}

/** Every usable cached zone, normalized and unexpired. Needs no coordinates. */
export async function readCachedZones(): Promise<Zone[]> {
  const zones = await readRaw()
  console.log(
    `[MapCache] read ${zones.length} zones (${zones.filter((z) => z.pending).length} pending)`,
  )
  return zones.map(({ cachedAt, ...zone }) => zone)
}

/**
 * Merge a successful fetch into the cache.
 *
 * The response is authoritative ONLY for the circle it was queried over, so cached
 * events outside that radius are preserved. This is what stops one fetch in a new city
 * from discarding the city the user actually lives in — the previous implementation
 * replaced the entire cache with whatever the last query returned.
 *
 * Pending local writes are always preserved: the server has not seen them yet, so its
 * silence about them means nothing.
 */
export async function writeFetchedZones(
  fetched: Zone[],
  center: { latitude: number; longitude: number },
  radiusKm: number,
): Promise<void> {
  const existing = await readRaw()
  const now = Date.now()
  const radiusMeters = radiusKm * 1000
  const fetchedIds = new Set(fetched.map((z) => z.id))

  const preserved = existing.filter((zone) => {
    if (zone.pending) return true
    // Superseded by this response.
    if (fetchedIds.has(zone.id)) return false
    const distance = distanceInMeters(
      zone.latitude,
      zone.longitude,
      center.latitude,
      center.longitude,
    )
    // Inside the queried circle and absent from the response ⇒ genuinely gone.
    return distance > radiusMeters
  })

  const dropped = existing.length - preserved.length
  console.log(
    `[MapCache] merge: ${fetched.length} fetched, ${preserved.length} preserved outside ${radiusKm}km, ${dropped} superseded/removed`,
  )
  await writeRaw([...preserved, ...fetched.map((zone) => ({ ...zone, cachedAt: now }))])
}

/** Insert or replace a single zone — used for optimistic writes and post-sync swaps. */
export async function upsertCachedZone(zone: Zone): Promise<void> {
  const existing = await readRaw()
  const withoutIt = existing.filter(
    (z) => z.id !== zone.id && (!zone.clientId || z.clientId !== zone.clientId),
  )
  await writeRaw([...withoutIt, { ...zone, cachedAt: Date.now() }])
}

/** Remove by server id or client id — a pending zone has both. */
export async function removeCachedZone(id: string): Promise<void> {
  const existing = await readRaw()
  await writeRaw(existing.filter((z) => z.id !== id && z.clientId !== id))
}
