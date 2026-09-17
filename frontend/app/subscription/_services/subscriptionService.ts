import { Linking } from 'react-native';

import { authFetch } from '../../../utils/api';
import { API_BASE_URL } from '../../../utils/config';
import { BillingPeriod, FamilyMember, PaymentProvider, Plan, Subscription } from '../_types';

type PlanResponse = {
  slug: string;
  name: string;
  description: string;
  monthly_price: number | null;
  annual_price: number | null;
  annual_discount: number;
  features: string[];
  is_free: boolean;
};

type SubscriptionResponse = {
  plan_slug: string;
  status: Subscription['status'];
  current_period_end: string | null;
  billing_period: BillingPeriod;
  payment_provider: PaymentProvider | null;
  cancel_at_period_end: boolean;
};

type FamilyMemberResponse = {
  id: string;
  name: string;
  initials: string;
  distance: number;
  distance_unit: 'km' | 'mts';
  avatar_color: string;
  last_updated: string | null;
  email?: string | null;
};

type CheckoutResponse = {
  checkout_url: string;
};

const FALLBACK_PLANS: Plan[] = [
  {
    slug: 'free',
    name: 'Bluai',
    description: 'Proteccion basica para ti',
    monthlyPrice: null,
    annualPrice: null,
    annualDiscount: 0,
    features: ['IA Empatica Offline', 'Mapa de Riesgos y Apoyo', 'Alertas SIAT-CT Oficiales'],
    isFree: true,
  },
  {
    slug: 'safe',
    name: 'Bluai Safe',
    description: 'Para familias que quieren estar siempre conectadas',
    monthlyPrice: 4.99,
    annualPrice: 49.9,
    annualDiscount: 17,
    features: ['Todo el plan Gratuito', 'Geolocalizacion de Familiares', 'Boton de Panico'],
    isFree: false,
  },
  {
    slug: 'guard',
    name: 'Blu Guard',
    description: 'Gestion de equipos y personal critico',
    monthlyPrice: 9.99,
    annualPrice: 99.9,
    annualDiscount: 17,
    features: [
      'Todo el plan Safe',
      'Gestion de Personal Critico',
      'Dashboard Predictivo Centralizado',
      'Comunicacion Ininterrumpida',
    ],
    isFree: false,
  },
  {
    slug: 'edu',
    name: 'Blu Edu',
    description: 'Para instituciones educativas',
    monthlyPrice: null,
    annualPrice: null,
    annualDiscount: 0,
    features: ['Todo el plan Gratuito', 'Geolocalizacion', 'Boton de Panico', 'Modulos de Resiliencia'],
    isFree: true,
  },
];

function toPlan(plan: PlanResponse): Plan {
  return {
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    monthlyPrice: plan.monthly_price,
    annualPrice: plan.annual_price,
    annualDiscount: plan.annual_discount,
    features: plan.features,
    isFree: plan.is_free,
  };
}

function toSubscription(subscription: SubscriptionResponse): Subscription {
  return {
    planSlug: subscription.plan_slug,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    billingPeriod: subscription.billing_period,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentProvider: subscription.payment_provider,
    saveCard: null,
    autoRenew: subscription.payment_provider === 'stripe' ? !subscription.cancel_at_period_end : null,
  };
}

function toFamilyMember(member: FamilyMemberResponse): FamilyMember {
  return {
    id: member.id,
    name: member.name,
    initials: member.initials,
    distance: member.distance,
    distanceUnit: member.distance_unit,
    avatarColor: member.avatar_color,
    lastUpdated: member.last_updated ?? '',
    email: member.email ?? undefined,
  };
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  const raw = await response.text().catch(() => '');

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    const detail = parsed && typeof parsed === 'object' ? (parsed as { detail?: unknown }).detail : null;
    if (typeof detail === 'string' && detail.trim()) {
      throw new Error(detail);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
  }

  throw new Error(raw || `Request failed with status ${response.status}.`);
}

export async function getPlans(): Promise<Plan[]> {
  try {
    const response = await authFetch(`${API_BASE_URL}/api/v1/payments/plans`);
    const data = await readJsonOrThrow<PlanResponse[]>(response);
    return Array.isArray(data) ? data.map(toPlan) : FALLBACK_PLANS;
  } catch {
    return FALLBACK_PLANS;
  }
}

export async function getSubscription(): Promise<Subscription> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/subscription`);
  const data = await readJsonOrThrow<SubscriptionResponse>(response);
  return toSubscription(data);
}

export async function getFamilyMembers(): Promise<FamilyMember[]> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/family-members`);
  const data = await readJsonOrThrow<FamilyMemberResponse[]>(response);
  return Array.isArray(data) ? data.map(toFamilyMember) : [];
}

export async function addFamilyMember(email: string): Promise<FamilyMember> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/family-members`, {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await readJsonOrThrow<FamilyMemberResponse>(response);
  return toFamilyMember(data);
}

export async function removeFamilyMember(memberId: string): Promise<void> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/family-members/${memberId}`, {
    method: 'DELETE',
  });
  await readJsonOrThrow<{ status: string }>(response);
}

export async function cancelSubscription(): Promise<Subscription> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/subscription/cancel`, {
    method: 'POST',
  });
  const data = await readJsonOrThrow<SubscriptionResponse>(response);
  return toSubscription(data);
}

export async function createCheckoutSession(
  planSlug: string,
  billingPeriod: BillingPeriod,
  provider: PaymentProvider | 'auto' = 'auto',
): Promise<string> {
  const response = await authFetch(`${API_BASE_URL}/api/v1/payments/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      plan_slug: planSlug,
      billing_period: billingPeriod,
      provider,
    }),
  });
  const data = await readJsonOrThrow<CheckoutResponse>(response);
  return data.checkout_url;
}

export async function openCheckoutSession(
  planSlug: string,
  billingPeriod: BillingPeriod,
  provider: PaymentProvider,
): Promise<void> {
  const checkoutUrl = await createCheckoutSession(planSlug, billingPeriod, provider);
  const supported = await Linking.canOpenURL(checkoutUrl);
  if (!supported) {
    throw new Error('No se pudo abrir el checkout en este dispositivo.');
  }
  await Linking.openURL(checkoutUrl);
}
