export type BillingPeriod = 'monthly' | 'annual';
export type PaymentProvider = 'stripe' | 'mercadopago';

export interface Plan {
  slug: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  annualDiscount: number;
  features: string[];
  isFree: boolean;
}

export interface Subscription {
  planSlug: string;
  status: 'active' | 'inactive' | 'canceled';
  currentPeriodEnd: string | null;
  billingPeriod?: BillingPeriod | null;
  cancelAtPeriodEnd?: boolean;
  paymentProvider?: PaymentProvider | null;
  saveCard?: boolean | null;
  autoRenew?: boolean | null;
}

export interface FamilyMember {
  id: string;
  name: string;
  initials: string;
  distance: number;
  distanceUnit: 'km' | 'mts';
  avatarColor: string;
  lastUpdated: string;
  email?: string;
}
