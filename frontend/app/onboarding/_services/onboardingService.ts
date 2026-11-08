import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OnboardingData } from '../_types';
import { APPLE_NAME_KEY } from '../../../features/auth/appleName';

const ONBOARDING_KEY = '@blueye_onboarding';
const ONBOARDING_COMPLETED_KEY = '@blueye_onboarding_completed';

/**
 * Marca de "este perfil ya está en el servidor".
 *
 * Su AUSENCIA es el estado pendiente — no hay una segunda bandera de "pending". Eso
 * hace que el reintento tras un fallo y el relleno de instalaciones viejas sean
 * literalmente el mismo camino de código: si no está la marca y hay datos locales,
 * hay que mandarlos.
 */
const PROFILE_SYNCED_KEY = '@blueye_profile_synced_v1';

/** Dueño del blob local. Ver `getStoredProfile` para por qué existe. */
const ONBOARDING_UID_KEY = '@blueye_onboarding_uid';

/**
 * Checks if user has completed onboarding
 */
export const hasCompletedOnboarding = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
    console.log('📦 AsyncStorage read - Key:', ONBOARDING_COMPLETED_KEY, 'Value:', value);
    return value === 'true';
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    return false;
  }
};

/**
 * Saves onboarding data to AsyncStorage.
 */
export const saveOnboardingData = async (data: OnboardingData, uid?: string | null): Promise<void> => {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(data));
    if (uid) await AsyncStorage.setItem(ONBOARDING_UID_KEY, uid);
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    console.log('✅ Onboarding data saved locally');
  } catch (error) {
    console.error('❌ Error saving onboarding data:', error);
    throw error;
  }
};

/**
 * Retrieves saved onboarding data
 */
export const getOnboardingData = async (): Promise<OnboardingData | null> => {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Error getting onboarding data:', error);
    return null;
  }
};

/** El blob local junto con el uid de quien lo capturó (null si nunca se guardó). */
export const getStoredProfile = async (): Promise<{ data: OnboardingData; uid: string | null } | null> => {
  try {
    const [raw, uid] = await Promise.all([
      AsyncStorage.getItem(ONBOARDING_KEY),
      AsyncStorage.getItem(ONBOARDING_UID_KEY),
    ]);
    if (!raw) return null;
    return { data: JSON.parse(raw) as OnboardingData, uid };
  } catch (error) {
    console.error('[ProfileSync] Error reading stored profile:', error);
    return null;
  }
};

export const isProfileSynced = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(PROFILE_SYNCED_KEY)) === 'true';
  } catch {
    // Ante la duda, decir "no sincronizado": el costo de un reenvío de más es una
    // petición idempotente; el de uno de menos es un perfil que nunca llega.
    return false;
  }
};

export const markProfileSynced = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(PROFILE_SYNCED_KEY, 'true');
  } catch (error) {
    console.error('[ProfileSync] Could not persist synced marker:', error);
  }
};

/**
 * Clears onboarding data (useful for testing)
 */
export const clearOnboardingData = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY,
      ONBOARDING_COMPLETED_KEY,
      PROFILE_SYNCED_KEY,
      ONBOARDING_UID_KEY,
      APPLE_NAME_KEY,
    ]);
  } catch (error) {
    console.error('Error clearing onboarding data:', error);
    throw error;
  }
};
