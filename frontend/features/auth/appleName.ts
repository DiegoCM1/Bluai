import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AppleAuthenticationFullName } from 'expo-apple-authentication'

/**
 * The name Sign in with Apple handed us, kept so onboarding can prefill it.
 *
 * App Review rejected build 19 under Guideline 4: after Sign in with Apple, users
 * must not be asked for information Apple already provided. Apple sends `fullName`
 * ONLY on the first authorization of the app — every later sign-in returns null —
 * so if we don't persist it the moment it arrives, it is gone for good.
 *
 * Written BEFORE `signInWithCredential`: that call fires `onAuthStateChanged`, which
 * routes to onboarding, and onboarding reads this on mount.
 */
export const APPLE_NAME_KEY = '@bluai_apple_name'

export interface AppleName {
  givenName: string
  familyName: string
}

/** Persists the Apple-provided name, if Apple sent one. Never throws. */
export async function saveAppleName(fullName: AppleAuthenticationFullName | null): Promise<boolean> {
  const givenName = fullName?.givenName?.trim() ?? ''
  const familyName = fullName?.familyName?.trim() ?? ''
  if (!givenName && !familyName) return false
  try {
    await AsyncStorage.setItem(APPLE_NAME_KEY, JSON.stringify({ givenName, familyName }))
    return true
  } catch {
    return false
  }
}

/** The stored Apple name, or null. Never throws. */
export async function readAppleName(): Promise<AppleName | null> {
  try {
    const raw = await AsyncStorage.getItem(APPLE_NAME_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      givenName: typeof parsed?.givenName === 'string' ? parsed.givenName : '',
      familyName: typeof parsed?.familyName === 'string' ? parsed.familyName : '',
    }
  } catch {
    return null
  }
}
