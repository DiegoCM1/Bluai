import { Subscription } from '../_types';
import { PAYMENTS_ENABLED } from '../../../utils/platformFeatures';

export type PlanSlug = 'free' | 'safe' | 'guard' | 'edu';

export type SubscriptionFeature =
  | 'bluetooth'
  | 'family_management'
  | 'family_location'
  | 'family_panic'
  | 'critical_staff'
  | 'central_dashboard'
  | 'critical_comms'
  | 'education_modules';

export interface FeatureDefinition {
  id: SubscriptionFeature;
  title: string;
  description: string;
  minimumPlan: PlanSlug;
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    id: 'bluetooth',
    title: 'Bluetooth offline',
    description: 'Conexión local por Bluetooth para funciones sin internet.',
    minimumPlan: 'safe',
  },
  {
    id: 'family_management',
    title: 'Administrar membresías',
    description: 'Alta, baja y control de miembros familiares.',
    minimumPlan: 'safe',
  },
  {
    id: 'family_location',
    title: 'Ubicación familiar',
    description: 'Seguimiento y ubicación compartida entre familiares.',
    minimumPlan: 'safe',
  },
  {
    id: 'family_panic',
    title: 'Botón de pánico familiar',
    description: 'Acceso familiar a flujos de apoyo y emergencia.',
    minimumPlan: 'safe',
  },
  {
    id: 'critical_staff',
    title: 'Gestión de personal crítico',
    description: 'Herramientas para equipos y personal prioritario.',
    minimumPlan: 'guard',
  },
  {
    id: 'central_dashboard',
    title: 'Dashboard centralizado',
    description: 'Vista operativa con supervision y control central.',
    minimumPlan: 'guard',
  },
  {
    id: 'critical_comms',
    title: 'Comunicación crítica',
    description: 'Canales reforzados para coordinacion de equipo.',
    minimumPlan: 'guard',
  },
  {
    id: 'education_modules',
    title: 'Modulos educativos',
    description: 'Contenido de resiliencia y capacitacion institucional.',
    minimumPlan: 'edu',
  },
];

const PLAN_RANK: Record<PlanSlug, number> = {
  free: 0,
  safe: 1,
  guard: 2,
  edu: 1,
};

export function getCurrentPlanSlug(subscription: Subscription | null): PlanSlug {
  if (subscription?.status && subscription.status !== 'active') return 'free';
  const raw = subscription?.planSlug ?? 'free';
  if (raw === 'safe' || raw === 'guard' || raw === 'edu') return raw;
  return 'free';
}

export function canAccessFeature(planSlug: PlanSlug, feature: SubscriptionFeature): boolean {
  // Where payments are disabled there is no purchase surface, so nothing may
  // present itself as locked — an upgrade wall would point at a route the build
  // no longer serves. Deliberately fails OPEN: every call site below fails
  // CLOSED on a network error, which is only correct while a way to buy exists.
  if (!PAYMENTS_ENABLED) return true;

  const definition = FEATURE_DEFINITIONS.find((item) => item.id === feature);
  if (!definition) return false;

  if (definition.minimumPlan === 'edu') {
    return planSlug === 'edu';
  }

  if (planSlug === 'edu') {
    return false;
  }

  return PLAN_RANK[planSlug] >= PLAN_RANK[definition.minimumPlan];
}

export function getMemberLimit(planSlug: PlanSlug): number {
  if (planSlug === 'guard') return 4;
  if (planSlug === 'safe') return 3;
  return 0;
}
