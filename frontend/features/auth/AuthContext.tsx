import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  AppleAuthProvider,
  GoogleAuthProvider,
  FirebaseAuthTypes,
} from '@react-native-firebase/auth'
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as Sentry from '@sentry/react-native'
import { authFetch } from '../../utils/api'
import { API_BASE_URL } from '../../utils/config'
import type { AuthContextValue } from './types'
import {
  AUTH_FAILURE_COPY,
  authBreadcrumb,
  reportAuthFailure,
  resetAuthFailureReporting,
  toMessage,
  type AuthFailure,
  type AuthTelemetryContext,
} from './authTelemetry'
import { saveAppleName } from './appleName'

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
})

// The Apple sheet is a system UI: presenting it moves the app out of `active`.
// No AppState change within this window ⇒ iOS never showed the sheet (build 18's
// App Review rejection on iPad). Generous on purpose — nonce + IPC take ~100ms.
const APPLE_SHEET_PRESENT_TIMEOUT_MS = 3_000
// Backstop for a sheet that was shown but never returned to us.
const APPLE_SHEET_TOTAL_TIMEOUT_MS = 120_000

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Monotonic attempt id. A native result is acted on only if no newer attempt has
  // started since — so a slow, abandoned request can't clobber a fresh one.
  const attemptRef = useRef(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(), (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
      if (firebaseUser) {
        Sentry.setUser({ id: firebaseUser.uid, email: firebaseUser.email ?? undefined })
        upsertUserProfile()
      } else {
        Sentry.setUser(null)
      }
    })
    return unsubscribe
  }, [])

  async function upsertUserProfile() {
    try {
      await authFetch(`${API_BASE_URL}/api/v1/users/me`, { method: 'POST' })
    } catch (e) {
      console.warn('[Bluai] Failed to upsert user profile:', e)
    }
  }

  async function getGoogleIdToken() {
    const signInResult = await GoogleSignin.signIn()

    if (signInResult?.type === 'cancelled') {
      return { cancelled: true as const, idToken: null }
    }

    const directIdToken =
      signInResult?.data?.idToken ??
      (signInResult as any)?.idToken ??
      (signInResult as any)?.data?.user?.idToken ??
      null

    if (directIdToken) {
      return { cancelled: false as const, idToken: directIdToken }
    }

    const tokens = await GoogleSignin.getTokens().catch(() => null)

    return {
      cancelled: false as const,
      idToken: tokens?.idToken ?? null,
    }
  }

  /** Report a failure and show its copy (if any) to the user. */
  function failSignIn(
    failure: AuthFailure,
    ctx: AuthTelemetryContext,
    level?: Sentry.SeverityLevel,
  ) {
    reportAuthFailure(failure, ctx, level)
    const copy = AUTH_FAILURE_COPY[failure.type]
    if (copy) setError(copy)
  }

  /** Starts an attempt; returns helpers scoped to it. */
  function beginAttempt() {
    const attempt = ++attemptRef.current
    const startedAt = Date.now()
    resetAuthFailureReporting()
    setSigningIn(true)
    setError(null)
    return {
      attempt,
      isCurrent: () => attempt === attemptRef.current,
      elapsed: () => Date.now() - startedAt,
      // Only the current attempt may release the UI — a stale one finishing late
      // must not flip `signingIn` off under a fresh attempt.
      release: () => {
        if (attempt === attemptRef.current) setSigningIn(false)
      },
    }
  }

  async function signInWithGoogle() {
    if (signingIn) return
    const { attempt, isCurrent, elapsed, release } = beginAttempt()
    authBreadcrumb('google: tap', { attempt })
    try {
      const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      if (!webClientId) {
        throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')
      }

      await GoogleSignin.hasPlayServices()
      const { cancelled, idToken } = await getGoogleIdToken()
      if (!isCurrent()) return

      if (cancelled) {
        authBreadcrumb('google: canceled', { elapsedMs: elapsed() })
        return
      }

      if (!idToken) {
        failSignIn(
          {
            type: 'no-identity-token',
            phase: 'provider-credential',
            message: 'Google Sign-In returned no ID token',
          },
          { provider: 'google', elapsedMs: elapsed() },
        )
        return
      }
      authBreadcrumb('google: credential received', { elapsedMs: elapsed() })

      try {
        await signInWithCredential(getAuth(), GoogleAuthProvider.credential(idToken))
      } catch (e: any) {
        failSignIn(
          {
            type: 'firebase-rejected',
            phase: 'firebase',
            message: toMessage(e),
          },
          { provider: 'google', code: e?.code, elapsedMs: elapsed() },
        )
        return
      }
      authBreadcrumb('google: firebase signed in', { elapsedMs: elapsed() })
    } catch (e: any) {
      if (!isCurrent()) return
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) return
      if (e?.code === statusCodes.IN_PROGRESS) return
      failSignIn(
        { type: 'provider-error', phase: 'sheet', message: toMessage(e) },
        { provider: 'google', code: e?.code, elapsedMs: elapsed() },
      )
    } finally {
      release()
    }
  }

  async function signInWithApple() {
    if (signingIn) return
    if (Platform.OS !== 'ios') {
      setError('Sign in with Apple solo está disponible en iOS.')
      return
    }
    const { attempt, isCurrent, elapsed, release } = beginAttempt()
    authBreadcrumb('apple: tap', { attempt })

    // Watchdog. A native request that never settles used to leave `signingIn` stuck
    // true forever — the button lost its handler and every later tap did nothing,
    // with nothing thrown and nothing reported. The watchdog releases the UI and
    // reports, but deliberately does NOT abandon the request: if the sheet was in
    // fact shown and AppState just didn't flip, a late credential still signs in.
    let sheetPresented = false
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !sheetPresented) {
        sheetPresented = true
        authBreadcrumb('apple: sheet presented', { elapsedMs: elapsed() })
      }
    })
    const presentTimer = setTimeout(() => {
      if (sheetPresented || !isCurrent()) return
      failSignIn(
        {
          type: 'sheet-not-presented',
          phase: 'sheet',
          message: `no AppState change within ${APPLE_SHEET_PRESENT_TIMEOUT_MS}ms`,
        },
        { provider: 'apple', elapsedMs: elapsed() },
      )
      release()
    }, APPLE_SHEET_PRESENT_TIMEOUT_MS)
    const totalTimer = setTimeout(() => {
      if (!isCurrent()) return
      failSignIn(
        {
          type: 'sheet-timeout',
          phase: 'sheet',
          message: `no result within ${APPLE_SHEET_TOTAL_TIMEOUT_MS}ms`,
        },
        { provider: 'apple', elapsedMs: elapsed() },
        'warning',
      )
      release()
    }, APPLE_SHEET_TOTAL_TIMEOUT_MS)

    try {
      const rawNonceBytes = await Crypto.getRandomBytesAsync(32)
      const rawNonce = Array.from(rawNonceBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      )
      authBreadcrumb('apple: nonce ready', { elapsedMs: elapsed() })

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      })
      if (!isCurrent()) {
        authBreadcrumb('apple: stale result ignored', { attempt })
        return
      }
      authBreadcrumb('apple: credential received', {
        elapsedMs: elapsed(),
        sheetPresented,
      })

      if (!appleCredential.identityToken) {
        failSignIn(
          {
            type: 'no-identity-token',
            phase: 'provider-credential',
            message: 'Apple Sign-In returned no identity token',
          },
          { provider: 'apple', elapsedMs: elapsed() },
        )
        return
      }

      // Guideline 4: never ask for what Apple already gave us. Persist the name now —
      // before signInWithCredential routes to onboarding, which prefills from it.
      const nameSaved = await saveAppleName(appleCredential.fullName)
      authBreadcrumb('apple: name', { provided: nameSaved })

      // `AppleAuthProvider.credential` is **static** and takes two positional
      // strings — (identityToken, rawNonce).
      const credential = AppleAuthProvider.credential(appleCredential.identityToken, rawNonce)
      try {
        await signInWithCredential(getAuth(), credential)
      } catch (e: any) {
        failSignIn(
          {
            type: 'firebase-rejected',
            phase: 'firebase',
            message: toMessage(e),
          },
          { provider: 'apple', code: e?.code, elapsedMs: elapsed() },
        )
        return
      }
      // A watchdog may have shown an error before this late success landed.
      setError(null)
      authBreadcrumb('apple: firebase signed in', { elapsedMs: elapsed() })
    } catch (e: any) {
      if (!isCurrent()) return
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        authBreadcrumb('apple: canceled', {
          elapsedMs: elapsed(),
          sheetPresented,
        })
        // A user can only cancel a sheet they saw. "Canceled" with no sheet is iOS
        // failing on its own — exactly the case that never reached Sentry before.
        if (!sheetPresented) {
          failSignIn(
            {
              type: 'cancel-without-sheet',
              phase: 'sheet',
              message: toMessage(e),
            },
            { provider: 'apple', code: e?.code, elapsedMs: elapsed() },
            'warning',
          )
        }
        return
      }
      failSignIn(
        { type: 'provider-error', phase: 'sheet', message: toMessage(e) },
        { provider: 'apple', code: e?.code, elapsedMs: elapsed() },
      )
    } finally {
      clearTimeout(presentTimer)
      clearTimeout(totalTimer)
      appStateSub.remove()
      release()
    }
  }

  async function signOut() {
    try {
      await GoogleSignin.signOut()
      if (getAuth().currentUser) {
        await firebaseSignOut(getAuth())
      }
    } catch (e: any) {
      console.error('[Bluai] Sign-out failed', {
        code: e?.code,
        message: e?.message,
      })
      throw e
    }
  }

  async function deleteAccount() {
    const currentUser = getAuth().currentUser
    if (!currentUser) throw new Error('No user logged in')
    try {
      // `/api/v1/users/me` es el endpoint vigente; `/users/account` es un alias
      // `deprecated=True` que existe solo para builds viejos de tester. Si alguien lo
      // quita, borrar cuenta devuelve 404 → rechazo seguro por Guideline 5.1.1(v).
      // authFetch adjunta el ID token de Firebase (convención de utils/api.ts).
      const response = await authFetch(`${API_BASE_URL}/api/v1/users/me`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error('[Bluai] Delete account failed', {
          status: response.status,
          body,
        })
        throw new Error('Failed to delete account')
      }
      await signOut()
    } catch (e: any) {
      console.error('[Bluai] Delete account error', {
        message: e?.message,
      })
      throw e
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signingIn, error, signInWithGoogle, signInWithApple, signOut, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
