import { getAuth, getIdToken } from '@react-native-firebase/auth'

export async function getAuthToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return getIdToken(user)
}

export interface AuthFetchOptions extends RequestInit {
  /**
   * Abort the request after this many ms (rejects with `name === 'AbortError'`).
   * Covers getting the response headers, not reading the body. Omit for no timeout.
   */
  timeoutMs?: number
}

/** True when `authFetch` rejected because its `timeoutMs` elapsed. */
export function isTimeoutError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  if (!timeoutMs) return fetch(url, init)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export async function authFetch(url: string, options: AuthFetchOptions = {}): Promise<Response> {
  const { timeoutMs, ...init } = options
  const token = await getAuthToken()
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    },
    timeoutMs,
  )

  if (res.status === 401) {
    const user = getAuth().currentUser
    if (!user) return res
    try {
      const freshToken = await getIdToken(user, true)
      return fetchWithTimeout(
        url,
        {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...init.headers,
            Authorization: `Bearer ${freshToken}`,
          },
        },
        timeoutMs,
      )
    } catch {
      return res
    }
  }

  return res
}
