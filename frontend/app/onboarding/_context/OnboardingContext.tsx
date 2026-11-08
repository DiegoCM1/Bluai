import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'expo-router';
import type { OnboardingData, OnboardingContextValue } from '../_types';
import { getAuth } from '@react-native-firebase/auth';
import { saveOnboardingData, markProfileSynced } from '../_services/onboardingService';
import { track } from '../../../utils/analytics';
import { pushProfile } from '../../../utils/profileSync';
import { readAppleName } from '../../../features/auth/appleName';
import { onboardingBreadcrumb, reportOnboardingFailure } from '../_services/onboardingTelemetry';

const initialData: OnboardingData = {
  firstName: '',
  lastName: '',
  phone: '',
  address1: '',
  address2: '',
  zipCode: '',
  state: '',
  nervousnessLevel: 5,
  age: '',
  weatherInfoLevel: 5,
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export const OnboardingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [data, setData] = useState<OnboardingData>(initialData);
  const router = useRouter();

  // Prefill the name from the sign-in provider so nobody retypes it. Apple's name is
  // persisted at sign-in (Guideline 4); Google's arrives as the Firebase displayName.
  // Only fills fields the user hasn't touched yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const apple = await readAppleName();
      let givenName = apple?.givenName ?? '';
      let familyName = apple?.familyName ?? '';
      if (!givenName && !familyName) {
        const [first = '', ...rest] = (getAuth().currentUser?.displayName ?? '').trim().split(/\s+/);
        givenName = first;
        familyName = rest.join(' ');
      }
      if (cancelled || (!givenName && !familyName)) return;
      setData(prev => ({
        ...prev,
        firstName: prev.firstName || givenName,
        lastName: prev.lastName || familyName,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field: keyof OnboardingData, value: string | number) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const updateMultipleFields = (updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  /**
   * Cierra el onboarding: guarda local, manda el perfil completo, navega.
   *
   * El envío se ESPERA y se revisa. Antes era una promesa desprendida con un
   * `.catch(() => {})` que, además, no veía los errores HTTP: `authFetch` devuelve el
   * Response tal cual, así que un 404 o un 500 se resolvían como éxito.
   *
   * Pero un fallo NO bloquea al usuario. Se le deja pasar y la marca de sincronizado se
   * queda sin poner, que es lo que hace que `syncProfileIfPending` lo reintente en el
   * próximo arranque. Bloquear aquí sería castigar con mala señal justo en el registro.
   */
  const submitOnboarding = async () => {
    try {
      const uid = getAuth().currentUser?.uid ?? null;
      await saveOnboardingData(data, uid);

      onboardingBreadcrumb('step2: submit start');
      const { ok: saved, failure } = await pushProfile(data);
      onboardingBreadcrumb('step2: submit end', { saved, failure });
      if (failure === 'timeout') {
        reportOnboardingFailure('submit-timeout', 'step2', {}, 'warning');
      }
      if (saved) {
        await markProfileSynced();
        console.log('[Onboarding] ✅ perfil guardado en el servidor');
      } else {
        // Ya quedó reportado con nombre en Sentry desde pushProfile; aquí solo se
        // deja constancia de que el usuario siguió adelante con un envío pendiente.
        console.warn(
          '[Onboarding] ⚠️  perfil NO confirmado por el servidor — quedó en cola. ' +
            'Se reintenta solo en el próximo arranque con sesión activa.',
        );
      }

      track('onboarding_completed', {
        nervousness_level: data.nervousnessLevel,
        age_range: data.age,
        weather_info_level: data.weatherInfoLevel,
        profile_synced: saved,
      });
      router.replace('/(tabs)/MapScreen');
    } catch (error) {
      // Solo llega aquí si falló la escritura LOCAL: sin eso no hay nada que
      // reintentar después, así que este sí es un error que el usuario debe ver.
      console.error('Error submitting onboarding:', error);
      reportOnboardingFailure('submit-local-failed', 'step2', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const resetOnboarding = () => {
    setData(initialData);
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        updateField,
        updateMultipleFields,
        submitOnboarding,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = (): OnboardingContextValue => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
};
