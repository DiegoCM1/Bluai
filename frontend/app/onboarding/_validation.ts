import type { OnboardingData, ValidationResult } from './_types';

/**
 * Validates Step 1 fields (Personal Information)
 */
export const validateStep1 = (data: Partial<OnboardingData>): ValidationResult => {
  const errors: Record<string, string> = {};

  // Only `state` is required. Name is optional by Guideline 4 (Sign in with Apple
  // users must not be asked for it); address and ZIP are optional to keep sign-up
  // minimal. Their format is still checked when the user does type something.
  if (data.address1 && data.address1.trim().length > 0 && data.address1.trim().length < 5) {
    errors.address1 = 'La dirección debe tener al menos 5 caracteres';
  }

  if (data.zipCode && data.zipCode.trim().length > 0 && !/^\d{5}$/.test(data.zipCode.trim())) {
    errors.zipCode = 'Debe ser un código postal de 5 dígitos';
  }

  // State validation
  if (!data.state || data.state.trim().length === 0) {
    errors.state = 'El estado es requerido';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

/**
 * Validates Step 2 fields (Preferences)
 */
export const validateStep2 = (data: Partial<OnboardingData>): ValidationResult => {
  const errors: Record<string, string> = {};

  // Nervousness level validation
  if (data.nervousnessLevel === undefined || data.nervousnessLevel < 1 || data.nervousnessLevel > 10) {
    errors.nervousnessLevel = 'Selecciona un nivel entre 1 y 10';
  }

  // Age validation
  if (!data.age || data.age.trim().length === 0) {
    errors.age = 'Selecciona tu rango de edad';
  }

  // Weather info level validation
  if (data.weatherInfoLevel === undefined || data.weatherInfoLevel < 1 || data.weatherInfoLevel > 10) {
    errors.weatherInfoLevel = 'Selecciona un nivel entre 1 y 10';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};