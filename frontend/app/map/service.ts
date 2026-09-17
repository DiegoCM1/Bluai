import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'

import { API_BASE_URL } from '../../utils/config'
import { MAP_EVENT_RADIUS_KM, REPORTING_DISTANCE_METERS } from './config'
import type { Zone } from './types'

const STORAGE_KEY = '@BluEye:redZones'
const DEV_BYPASS_MAP_AUTH = process.env.EXPO_PUBLIC_DEV_BYPASS_MAP_AUTH === 'true'

type ReporterLocation = {
  latitude: number
  longitude: number
}

type LoadZonesParams = ReporterLocation & {
  radiusKm?: number
}

type MapEventResponse = {
  can_vote?: boolean
  id: string
  user_id?: number | null
  is_owner?: boolean
  type: Zone['type']
  description: string
  distance_km?: number | null
  downvotes?: number
  lat: number
  lon: number
  trust_status?: NonNullable<Zone['trustStatus']>
  upvotes?: number
  created_at?: string
  updated_at?: string
  user_vote?: Zone['userVote']
  within_voting_radius?: boolean
  address?: string | null
}

// Exported so the offline cache can normalize what it reads back: cached entries were
// written as plain JSON and come back with whatever shape the app had when it stored
// them, not necessarily the current Zone contract.
export function normalizeZone(event: MapEventResponse): Zone {
  return {
    id: String(event.id),
    latitude: Number(event.lat),
    longitude: Number(event.lon),
    description: String(event.description),
    timestamp: String(event.created_at ?? event.updated_at ?? new Date().toISOString()),
    radius: 500,
    type: event.type,
    upvotes: event.upvotes ?? 0,
    downvotes: event.downvotes ?? 0,
    userVote: event.user_vote ?? null,
    isOwner: event.is_owner ?? false,
    distanceKm: event.distance_km ?? null,
    withinVotingRadius: event.within_voting_radius ?? false,
    canVote: event.can_vote ?? false,
    trustStatus: event.trust_status ?? 'en_revision',
    address: event.address ?? null,
  }
}

export function generateZoneId() {
  return `zone_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Carries the HTTP status so callers can tell a REJECTED request from an UNREACHABLE
 * one. Without it every failure looks identical: the map used to report a network
 * outage as "debes estar cerca del evento", and the write queue had no way to know
 * whether retrying was pointless (4xx) or the only sensible move (5xx / offline).
 */
export class MapHttpError extends Error {
  readonly status: number

  constructor(status: number, message?: string) {
    super(message || `Map request failed: ${status}`)
    this.name = 'MapHttpError'
    this.status = status
  }
}

// FastAPI puts the human-readable reason in a JSON `detail` field. Pulling it out here
// means callers can tell "you must be within 10 km" apart from "you cannot vote for your
// own event" — the map used to show the distance message for BOTH, plus for 404, 409 and
// every network failure.
async function mapHttpError(response: Response): Promise<MapHttpError> {
  const body = await response.text().catch(() => '')
  let detail = body
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed.detail === 'string') detail = parsed.detail
  } catch {
    // Not JSON — the raw text is the best we have.
  }
  return new MapHttpError(response.status, detail)
}

/** A 4xx other than 429: the request itself is wrong, so replaying it cannot help. */
export function isPermanentRejection(error: unknown): boolean {
  return (
    error instanceof MapHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  )
}

/** No status at all means the request never reached the server (offline, DNS, timeout). */
export function isUnreachable(error: unknown): boolean {
  return !(error instanceof MapHttpError)
}

const GEOCODE_TIMEOUT_MS = 5000

// Reverse-geocode coordinates into a human-readable "Calle, Colonia, Ciudad" string,
// ONCE, on the reporter's device (free OS geocoder — no API key, no per-viewer cost).
// Returns null on any failure (offline, no result, timeout, no permission) so callers
// fall back to coordinates. Never throws — a geocode hiccup must not block a report.
export async function reverseGeocodeAddress(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('geocode timeout')), GEOCODE_TIMEOUT_MS),
    )
    const results = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      timeout,
    ])
    const place = results?.[0]
    if (!place) return null
    // Build defensively — fields vary by platform/locale and any can be null.
    // Order: calle (street) → colonia (district) → municipio/ciudad (city ?? subregion).
    const parts = [place.street, place.district, place.city ?? place.subregion].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  } catch {
    return null
  }
}

// Human-friendly "how long ago" for an event timestamp.
// Degrades: unos segundos → X min → X h → X días → absolute date (>7 días).
// Guards clock skew: a server timestamp slightly ahead of the device reads "hace un momento".
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 0) return 'hace un momento'
  if (diffSec < 60) return 'hace unos segundos'

  const minutes = Math.floor(diffSec / 60)
  if (minutes < 60) return `hace ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`

  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function distanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

export function canReportFromLocation(
  eventLocation: ReporterLocation,
  reporterLocation: ReporterLocation
) {
  return (
    distanceInMeters(
      eventLocation.latitude,
      eventLocation.longitude,
      reporterLocation.latitude,
      reporterLocation.longitude
    ) <= REPORTING_DISTANCE_METERS
  )
}

export async function loadCachedZones() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY)
    const parsed = data ? JSON.parse(data) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('[Map] Error loading cached zones:', error)
    return []
  }
}

async function saveCachedZones(zones: Zone[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(zones))
}

// Exported for the offline write queue, which must replay requests through the SAME
// path as a live one. Calling authFetch directly there would silently bypass
// DEV_BYPASS_MAP_AUTH and break the dev-auth escape hatch for replayed writes only.
export async function mapFetch(path: string, options: RequestInit = {}) {
  if (DEV_BYPASS_MAP_AUTH) {
    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  }

  const { authFetch } = await import('../../utils/api')
  return authFetch(`${API_BASE_URL}${path}`, options)
}

export async function loadZones({
  latitude,
  longitude,
  radiusKm = MAP_EVENT_RADIUS_KM,
}: LoadZonesParams) {
  try {
    const search = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      radius_km: String(radiusKm),
    })

    const response = await mapFetch(`/api/v1/map-events?${search.toString()}`)
    if (!response.ok) {
      throw new Error(`Failed to load map events: ${response.status}`)
    }

    const data = await response.json()
    const zones = Array.isArray(data) ? data.map(normalizeZone) : []
    await saveCachedZones(zones)
    return zones
  } catch (error) {
    console.warn('[Map] Falling back to cached zones:', error)
    return await loadCachedZones()
  }
}

/**
 * Fetch events around a point. THROWS on any failure, unlike loadZones, which silently
 * substitutes cached data — leaving the caller unable to tell fresh data from stale and
 * therefore unable to tell the user. The cache fallback now lives in useZones.
 */
export async function fetchZones({
  latitude,
  longitude,
  radiusKm = MAP_EVENT_RADIUS_KM,
}: LoadZonesParams): Promise<Zone[]> {
  const search = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    radius_km: String(radiusKm),
  })

  const response = await mapFetch(`/api/v1/map-events?${search.toString()}`)
  if (!response.ok) throw await mapHttpError(response)

  const data = await response.json()
  return Array.isArray(data) ? data.map(normalizeZone) : []
}

export async function createZone(zone: Zone) {
  const response = await mapFetch('/api/v1/map-events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: zone.type,
      description: zone.description,
      lat: zone.latitude,
      lon: zone.longitude,
      address: zone.address ?? null,
    }),
  })

  if (!response.ok) {
    throw await mapHttpError(response)
  }

  const data = await response.json()
  return normalizeZone(data)
}

export async function voteZone(
  zoneId: string,
  value: 1 | -1,
  voterLocation: ReporterLocation
) {
  const response = await mapFetch(`/api/v1/map-events/${zoneId}/vote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      value,
      lat: voterLocation.latitude,
      lon: voterLocation.longitude,
    }),
  })

  if (!response.ok) {
    throw await mapHttpError(response)
  }

  const data = await response.json()
  return normalizeZone(data)
}

// Takes only what it sends. A full Zone still satisfies this, so live call sites are
// unchanged, while the replay queue can pass the two fields it stored without faking
// the rest of a Zone.
export async function updateZone(zone: Pick<Zone, 'id' | 'description'>) {
  const response = await mapFetch(`/api/v1/map-events/${zone.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ description: zone.description }),
  })

  if (!response.ok) {
    throw await mapHttpError(response)
  }

  const data = await response.json()
  return normalizeZone(data)
}

export async function deleteZone(zoneId: string) {
  const response = await mapFetch(`/api/v1/map-events/${zoneId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw await mapHttpError(response)
  }
}

export async function syncCachedZones(zones: Zone[]) {
  try {
    await saveCachedZones(zones)
  } catch (error) {
    console.error('[Map] Error saving cached zones:', error)
  }
}

export type ActiveCyclone = {
  id: number
  source: string
  name: string
  latitude: number
  longitude: number
  windKmh: number | null
  movementDirection: string | null
  movementDirectionDeg: number | null
  movementSpeedKmh: number | null
  categoryCode: string
  categoryLabel: string
  advisoryTime: string | null
}

type ActiveCycloneResponse = {
  id: number
  source: string
  name: string
  lat: number
  lon: number
  wind_kmh: number | null
  movement_direction: string | null
  movement_direction_deg: number | null
  movement_speed_kmh: number | null
  category_code: string
  category_label: string
  advisory_time: string | null
}

function normalizeActiveCyclone(item: ActiveCycloneResponse): ActiveCyclone {
  return {
    id: item.id,
    source: item.source,
    name: item.name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    windKmh: item.wind_kmh ?? null,
    movementDirection: item.movement_direction ?? null,
    movementDirectionDeg: item.movement_direction_deg ?? null,
    movementSpeedKmh: item.movement_speed_kmh ?? null,
    categoryCode: item.category_code,
    categoryLabel: item.category_label,
    advisoryTime: item.advisory_time ?? null,
  }
}

// Always requires real Firebase auth — unlike mapFetch, there is no dev-auth
// bypass for this endpoint (see DEV_BYPASS_MAP_AUTH), so it calls authFetch directly.
export async function loadActiveCyclones(): Promise<ActiveCyclone[]> {
  const { authFetch } = await import('../../utils/api')
  const response = await authFetch(`${API_BASE_URL}/api/v1/siat/active-cyclones`)
  if (!response.ok) {
    throw new Error(`Failed to load active cyclones: ${response.status}`)
  }
  const data: { total: number; cyclones: ActiveCycloneResponse[] } = await response.json()
  return data.cyclones.map(normalizeActiveCyclone)
}
