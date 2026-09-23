import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Platform } from 'react-native'
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

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
})

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/users/me`, { method: 'POST' })
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

  async function signInWithGoogle() {
    if (signingIn) return
    setSigningIn(true)
    setError(null)
    try {
      const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      if (!webClientId) {
        throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')
      }

      await GoogleSignin.hasPlayServices()
      const { cancelled, idToken } = await getGoogleIdToken()

      if (cancelled) return

      if (!idToken) {
        console.error('[Bluai] Google Sign-In returned no ID token', {
          webClientIdConfigured: Boolean(webClientId),
        })
        throw new Error('Google Sign-In returned no ID token')
      }

      const credential = GoogleAuthProvider.credential(idToken)
      await signInWithCredential(getAuth(), credential)
      await upsertUserProfile()
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) return
      if (e?.code === statusCodes.IN_PROGRESS) return
      console.error('[Bluai] Google Sign-In failed', {
        code: e?.code,
        message: e?.message,
      })
      Sentry.captureException(e, {
        tags: { flow: 'google-signin' },
        extra: { code: e?.code },
      })
      setError('No se pudo iniciar sesión. Intenta de nuevo.')
    } finally {
      setSigningIn(false)
    }
  }

  async function signInWithApple() {
    if (signingIn) return
    if (Platform.OS !== 'ios') {
      setError('Sign in with Apple solo está disponible en iOS.')
      return
    }
    setSigningIn(true)
    setError(null)
    try {
      const available = await AppleAuthentication.isAvailableAsync()
      if (!available) {
        setError('Sign in with Apple no está disponible en este dispositivo.')
        return
      }

      const rawNonceBytes = await Crypto.getRandomBytesAsync(32)
      const rawNonce = Array.from(rawNonceBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      )

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      })

      if (!appleCredential.identityToken) {
        console.error('[Bluai] Apple Sign-In returned no identity token')
        throw new Error('Apple Sign-In returned no identity token')
      }

      // `AppleAuthProvider.credential` is **static** and takes two positional
      // strings — (identityToken, rawNonce).
      const credential = AppleAuthProvider.credential(
        appleCredential.identityToken,
        rawNonce,
      )
      await signInWithCredential(getAuth(), credential)
      await upsertUserProfile()
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return
      console.error('[Bluai] Apple Sign-In failed', {
        code: e?.code,
        message: e?.message,
      })
      Sentry.captureException(e, {
        tags: { flow: 'apple-signin' },
        extra: { code: e?.code },
      })
      setError('No se pudo iniciar sesión con Apple. Intenta de nuevo.')
    } finally {
      setSigningIn(false)
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
