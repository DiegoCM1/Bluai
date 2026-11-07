import AsyncStorage from '@react-native-async-storage/async-storage'
import { toast } from 'sonner-native'
import { authFetch } from '../../utils/api'
import { API_BASE_URL } from '../../utils/config'
import { showSOSResultAlert } from './_utils/sosResultAlert'

const QUEUE_KEY = '@BluEye:sos_queue'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Guard: evita flush simultáneo (mount + _layout.tsx AppState disparan al mismo tiempo)
let isFlushingSOSQueue = false

export type SOSQueueItem = {
  id: string
  lat?: number
  lon?: number
  queuedAt: number
}

// Guarda un intento SOS. Solo mantiene 1 item (el más reciente con coords frescas).
export async function enqueueSOS(lat?: number, lon?: number): Promise<void> {
  const item: SOSQueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lat,
    lon,
    queuedAt: Date.now(),
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([item]))
}

// Lee la cola y descarta items expirados (>24h).
export async function getSOSQueue(): Promise<SOSQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const items: SOSQueueItem[] = JSON.parse(raw)
    return items.filter((i) => Date.now() - i.queuedAt < MAX_AGE_MS)
  } catch {
    return []
  }
}

export async function hasPendingSOSItem(): Promise<boolean> {
  return (await getSOSQueue()).length > 0
}

export async function getPendingSOSItem(): Promise<SOSQueueItem | null> {
  const items = await getSOSQueue()
  return items.length > 0 ? items[0] : null
}

export async function clearSOSQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY)
}

// Devuelve true si hay un SOS pendiente más antiguo que maxAgeMs.
// Úsalo antes de un flush automático para evitar enviar SOS viejos sin confirmación del usuario.
export async function shouldConfirmPendingSOS(maxAgeMs = 30 * 60 * 1000): Promise<boolean> {
  const item = await getPendingSOSItem()
  if (!item) return false
  return Date.now() - item.queuedAt > maxAgeMs
}

async function removeSOSItem(id: string): Promise<void> {
  const current = await getSOSQueue()
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(current.filter((i) => i.id !== id)))
}

// Intenta enviar los items pendientes. Protegido con guard para evitar ejecuciones concurrentes.
// Reglas de cola:
//   - network error / 5xx / 429 → mantener en cola para reintentar
//   - 4xx (no 429)              → eliminar de cola (no reintentable) + Toast de error
//   - éxito                     → eliminar y mostrar Toast
export async function flushSOSQueue(): Promise<void> {
  if (isFlushingSOSQueue) return
  isFlushingSOSQueue = true
  try {
    const items = await getSOSQueue()
    if (items.length === 0) return

    for (const item of items) {
      try {
        const body: { lat?: number; lon?: number } = {}
        if (item.lat !== undefined) body.lat = item.lat
        if (item.lon !== undefined) body.lon = item.lon

        const res = await authFetch(`${API_BASE_URL}/api/v1/sos/trigger`, {
          method: 'POST',
          body: JSON.stringify(body),
        })

        if (res.status === 429) continue // rate limited → mantener

        if (res.status >= 500) continue // error de servidor → mantener

        if (!res.ok) {
          // 4xx (no 429): error de cliente, no reintentable → eliminar con aviso
          await removeSOSItem(item.id)
          toast.error('SOS no enviado', {
            description: 'Hubo un error. Tus contactos no fueron notificados.',
          })
          continue
        }

        await removeSOSItem(item.id)
        const data = await res.json().catch(() => null)
        showSOSResultAlert(data)
      } catch {
        // Red no disponible → mantener en cola
      }
    }
  } finally {
    isFlushingSOSQueue = false
  }
}
