/**
 * Onboarding TypeScript Types
 * Defines interfaces for user data collection during first-time setup
 */

export interface OnboardingData {
    firstName: string;
    lastName: string;
    phone?: string;
    address1: string;
    address2?: string;
    zipCode: string;
    state: string; // Changed from city to state
    nervousnessLevel: number; // 1-10
    age: string; // Age range
    weatherInfoLevel: number; // 1-10
  }

  export interface OnboardingContextValue {
    data: OnboardingData;
    updateField: (field: keyof OnboardingData, value: string | number) => void;
    updateMultipleFields: (updates: Partial<OnboardingData>) => void;
    submitOnboarding: () => Promise<void>;
    resetOnboarding: () => void;
  }

  export interface ValidationResult {
    isValid: boolean;
    errors: Record<string, string>;
  }

  export const AGE_RANGES = [
    '18-25',
    '26-35',
    '36-45',
    '46-55',
    '56-65',
    '66+',
  ] as const;

  export type AgeRange = typeof AGE_RANGES[number];

  // Estados de México (32 estados)
  export const MEXICO_STATES = [
    'Aguascalientes',
    'Baja California',
    'Baja California Sur',
    'Campeche',
    'Chiapas',
    'Chihuahua',
    'Ciudad de México',
    'Coahuila',
    'Colima',
    'Durango',
    'Guanajuato',
    'Guerrero',
    'Hidalgo',
    'Jalisco',
    'Estado de México',
    'Michoacán',
    'Morelos',
    'Nayarit',
    'Nuevo León',
    'Oaxaca',
    'Puebla',
    'Querétaro',
    'Quintana Roo',
    'San Luis Potosí',
    'Sinaloa',
    'Sonora',
    'Tabasco',
    'Tamaulipas',
    'Tlaxcala',
    'Veracruz',
    'Yucatán',
    'Zacatecas',
    // Escape hatch for anyone outside Mexico (App Review tests from the US). The
    // backend stores `state` as free text and nothing keys logic off it.
    'Fuera de México',
  ] as const;

  export type MexicoState = typeof MEXICO_STATES[number];