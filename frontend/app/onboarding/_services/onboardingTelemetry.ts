import * as Sentry from '@sentry/react-native';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * OBSERVABILITY for onboarding.
 *
 * App Review rejected build 19 because "the continue button was unresponsive" on
 * onboarding — and we couldn't tell from our side whether the tap was blocked by
 * validation, swallowed by the keyboard, or stuck on the network. This module gives
 * each of those a name in Sentry, with the device context (iPad vs iPhone, model,
 * OS) the rejection hinged on.
 *
 * Mirrors `features/auth/authTelemetry.ts`. PRIVACY: report field NAMES only, never
 * values — onboarding collects name, phone and address.
 */

export type OnboardingStep = 'step1' | 'step2';

export type OnboardingFailureType =
  | 'validation-blocked' // the user tapped next and validation stopped them
  | 'submit-timeout' // PUT /users/me/profile never answered (user still proceeds)
  | 'submit-local-failed'; // the local AsyncStorage write failed — the one fatal case

function deviceTags(): Record<string, string> {
  return {
    feature: 'onboarding',
    platform: Platform.OS,
    isPad: String(Platform.OS === 'ios' && Platform.isPad),
  };
}

export function reportOnboardingFailure(
  type: OnboardingFailureType,
  step: OnboardingStep,
  extra: Record<string, unknown> = {},
  level: Sentry.SeverityLevel = 'error',
) {
  console.error(`[Onboarding] FAILURE type=${type} step=${step}`, extra);
  Sentry.captureException(new Error(`onboarding: ${type}`), {
    level,
    tags: { ...deviceTags(), failureType: type, step },
    extra: {
      ...extra,
      modelName: Device.modelName,
      osVersion: Device.osVersion,
    },
  });
}

/** A stage breadcrumb so a Sentry event shows the path that led to it. */
export function onboardingBreadcrumb(message: string, data?: Record<string, unknown>) {
  console.log(`[Onboarding] ${message}`, data ?? '');
  Sentry.addBreadcrumb({ category: 'onboarding', level: 'info', message, data });
}
