import '../../global.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, ScrollView, ActivityIndicator, Alert, TouchableOpacity, Animated, Easing, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { track } from '../../utils/analytics';
import ScreenHeader from '../../components/ScreenHeader';
import { colors } from '../../utils/theme';
import PlanCard from './_components/PlanCard';
import FeatureAccessCard from './_components/FeatureAccessCard';
import StripePaymentSheet from './_components/StripePaymentSheet';
import { cancelSubscription, getPlans, getSubscription, openCheckoutSession } from './_services/subscriptionService';
import { BillingPeriod, PaymentProvider, Plan, Subscription } from './_types';
import { FEATURE_DEFINITIONS, canAccessFeature, getCurrentPlanSlug, getMemberLimit } from './_utils/planAccess';

const FALLBACK_PLANS: Plan[] = [
  {
    slug: 'free',
    name: 'Bluai',
    description: 'Protección básica para ti',
    monthlyPrice: null,
    annualPrice: null,
    annualDiscount: 0,
    features: ['IA Empática Offline', 'Mapa de Riesgos y Apoyo', 'Alertas SIAT-CT Oficiales'],
    isFree: true,
  },
  {
    slug: 'safe',
    name: 'Bluai Safe',
    description: 'Para familias que quieren estar siempre conectadas',
    monthlyPrice: 4.99,
    annualPrice: 49.9,
    annualDiscount: 17,
    features: ['Todo el plan Gratuito', 'Geolocalización de Familiares', 'Botón de Pánico'],
    isFree: false,
  },
  {
    slug: 'guard',
    name: 'Blu Guard',
    description: 'Gestión de equipos y personal crítico',
    monthlyPrice: 9.99,
    annualPrice: 99.9,
    annualDiscount: 17,
    features: [
      'Todo el plan Safe',
      'Gestión de Personal Crítico',
      'Dashboard Predictivo Centralizado',
      'Comunicación Ininterrumpida',
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
    features: ['Todo el plan Gratuito', 'Geolocalización', 'Botón de Pánico', 'Módulos de Resiliencia'],
    isFree: true,
  },
];

function buildDefaultBillingPeriods(plans: Plan[]) {
  const defaults: Record<string, BillingPeriod> = {};
  plans.forEach((plan) => {
    defaults[plan.slug] = 'monthly';
  });
  return defaults;
}

function formatBillingPeriod(period?: BillingPeriod | null, isFreePlan = false) {
  if (isFreePlan) return 'Sin pago';
  if (period === 'annual') return 'anual';
  if (period === 'monthly') return 'mensual';
  return 'según proveedor';
}

function formatPeriodEnd(dateValue: string | null) {
  if (!dateValue) return null;

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [billingPeriods, setBillingPeriods] = useState<Record<string, BillingPeriod>>(
    () => buildDefaultBillingPeriods(FALLBACK_PLANS),
  );
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  const orbFloat = useRef(new Animated.Value(0)).current;
  const chipPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    track('subscription_main_view');
    void load();
  }, []);

  useEffect(() => {
    const subscriptionReturnListener = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('blueye://subscription')) {
        void load();
      }
    });

    return () => subscriptionReturnListener.remove();
  }, []);

  useEffect(() => {
    const orbLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbFloat, {
          toValue: 1,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(orbFloat, {
          toValue: 0,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const chipLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(chipPulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(chipPulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    orbLoop.start();
    chipLoop.start();

    return () => {
      orbLoop.stop();
      chipLoop.stop();
    };
  }, [chipPulse, orbFloat]);

  async function load() {
    setRefreshing(true);
    try {
      const [plansData, sub] = await Promise.all([
        getPlans().catch(() => FALLBACK_PLANS),
        getSubscription().catch(() => null),
      ]);

      setPlans(plansData);
      setSubscription(sub);
      setBillingPeriods((prev) => ({ ...buildDefaultBillingPeriods(plansData), ...prev }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleBillingChange = (slug: string, period: BillingPeriod) => {
    setBillingPeriods((prev) => ({ ...prev, [slug]: period }));
    track('subscription_billing_toggle', { slug, period });
  };

  const currentSlug = getCurrentPlanSlug(subscription);
  const canManageFamily = canAccessFeature(currentSlug, 'family_management');
  const memberLimit = getMemberLimit(currentSlug);
  const isFreeCurrentPlan = currentSlug === 'free' || currentSlug === 'edu';
  const currentPeriodLabel = formatBillingPeriod(subscription?.billingPeriod, isFreeCurrentPlan);
  const currentPeriodEndLabel = formatPeriodEnd(subscription?.currentPeriodEnd ?? null);

  const orbTranslateY = orbFloat.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
  });

  const chipScale = chipPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const shimmerX = orbFloat.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, 220],
  });

  const activePlanLabel = useMemo(() => {
    const activePlan = plans.find((plan) => plan.slug === currentSlug);
    return activePlan?.name ?? 'Bluai';
  }, [plans, currentSlug]);

  const handleSubscribe = async (plan: Plan) => {
    const period = billingPeriods[plan.slug] ?? 'monthly';
    track('subscription_cta_tap', { slug: plan.slug, period });

    if (plan.isFree) {
      Alert.alert('Plan base', 'Tu cuenta ya incluye el plan Bluai sin pago adicional.');
      return;
    }

    setPendingPlan(plan);
  };

  const handleSelectPaymentProvider = async (provider: PaymentProvider) => {
    if (!pendingPlan) return;

    const period = billingPeriods[pendingPlan.slug] ?? 'monthly';
    setSheetLoading(true);

    try {
      await openCheckoutSession(pendingPlan.slug, period, provider);
      setPendingPlan(null);
      Alert.alert(
        'Checkout abierto',
        `${pendingPlan.name}: continúa el pago con Stripe en la ventana que se abrió.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo abrir el checkout.';
      Alert.alert('Error', msg);
    } finally {
      setSheetLoading(false);
    }
  };

  const handleFeaturePress = (featureId: (typeof FEATURE_DEFINITIONS)[number]['id']) => {
    if (featureId === 'family_management' && canManageFamily) {
      router.push('/subscription/manage');
      return;
    }

    const definition = FEATURE_DEFINITIONS.find((item) => item.id === featureId);
    if (!definition) return;

    const requiredLabel =
      definition.minimumPlan === 'safe'
        ? 'Safe'
        : definition.minimumPlan === 'guard'
          ? 'Guard'
          : 'Edu';

    Alert.alert(
      'Función bloqueada',
      `Esta función pertenece al plan ${requiredLabel}. Activa ese plan para desbloquearla.`,
    );
  };

  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancelar renovacion',
      'Conservaras los beneficios hasta la fecha de vencimiento. Despues no se renovara el plan.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar renovacion',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const updatedSubscription = await cancelSubscription();
              setSubscription(updatedSubscription);
              Alert.alert('Renovacion cancelada', 'Tu plan seguira activo hasta su vencimiento.');
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'No se pudo cancelar la renovacion.';
              Alert.alert('No se pudo cancelar', message);
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-transparent items-center justify-center">
        <ActivityIndicator size="large" color={colors.brandCyan} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="Suscripción" />

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {refreshing ? (
          <View className="px-4 pt-4">
            <View className="rounded-2xl px-4 py-3 bg-cyan-500/10 border border-cyan-400/20 flex-row items-center">
              <ActivityIndicator size="small" color={colors.brandCyan} />
              <Text className="text-white ml-3">Actualizando suscripción...</Text>
            </View>
          </View>
        ) : null}

        <View className="px-4 pt-4">
          <LinearGradient
            colors={['#06101d', '#0b1c31', '#12314f']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 30, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(120,210,255,0.14)' }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                top: -30,
                right: -20,
                width: 180,
                height: 180,
                borderRadius: 999,
                backgroundColor: 'rgba(72,186,255,0.10)',
                transform: [{ translateY: orbTranslateY }],
              }}
            />
            <Animated.View
              style={{
                position: 'absolute',
                bottom: -50,
                left: -35,
                width: 220,
                height: 220,
                borderRadius: 999,
                backgroundColor: 'rgba(49,103,255,0.10)',
                transform: [{ scale: chipScale }],
              }}
            />
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: 120,
                backgroundColor: 'rgba(255,255,255,0.05)',
                transform: [{ translateX: shimmerX }, { skewX: '-18deg' as any }],
              }}
            />
            <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 24 }}>
              <Animated.View
                style={{
                  alignSelf: 'flex-start',
                  transform: [{ scale: chipScale }],
                }}
              >
                <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
                  <Text style={{ color: '#d3f6ff', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                    MEMBRESÍAS BLUAI
                  </Text>
                </View>
              </Animated.View>

              <Text
                style={{
                  fontFamily: 'Square721',
                  color: 'white',
                  fontSize: 30,
                  lineHeight: 34,
                  marginTop: 18,
                  maxWidth: '82%',
                }}
              >
                {'Controla tu plan\nsin complicarlo'}
              </Text>

              <Text className="text-white/72 text-sm mt-3" style={{ lineHeight: 20, maxWidth: '85%' }}>
                Activa beneficios reales, elige cómo pagar y revisa qué funciones quedan desbloqueadas en tu cuenta.
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <View style={{ flex: 1, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ color: '#8be6ff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>
                    PLAN ACTIVO
                  </Text>
                  <Text style={{ color: 'white', fontSize: 14, marginTop: 6, fontWeight: '700' }}>
                    {activePlanLabel}
                  </Text>
                </View>
                <View style={{ flex: 1, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={{ color: '#8be6ff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>
                    BLUETOOTH
                  </Text>
                  <Text style={{ color: 'white', fontSize: 14, marginTop: 6, fontWeight: '700' }}>
                    Safe y Guard
                  </Text>
                </View>
              </View>
            </View>
          </LinearGradient>
        </View>

        <View className="px-4 pt-4 pb-4">
          <LinearGradient
            colors={['rgba(12,21,39,0.96)', 'rgba(9,42,69,0.88)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 18, borderWidth: 1, borderColor: 'rgba(95,187,255,0.14)' }}
          >
            <Text className="text-white/55 text-xs tracking-widest">ESTADO ACTUAL</Text>
            <Text className="text-white text-2xl font-bold mt-2">{currentSlug.toUpperCase()}</Text>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <Text className="text-white/55 text-[11px]">Periodo</Text>
                <Text className="text-white text-sm mt-1 font-semibold">{currentPeriodLabel}</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <Text className="text-white/55 text-[11px]">Vencimiento</Text>
                <Text className="text-white text-sm mt-1 font-semibold">{currentPeriodEndLabel ?? 'Sin fecha'}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <Text className="text-white/55 text-[11px]">Metodo de pago</Text>
                <Text className="text-white text-sm mt-1 font-semibold">
                  {isFreeCurrentPlan
                    ? 'No aplica'
                    : subscription?.paymentProvider === 'mercadopago'
                      ? 'Mercado Pago'
                      : 'Tarjeta via Stripe'}
                </Text>
              </View>
              <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <Text className="text-white/55 text-[11px]">Renovacion</Text>
                <Text className="text-white text-sm mt-1 font-semibold">
                  {isFreeCurrentPlan
                    ? 'No aplica'
                    : subscription?.paymentProvider === 'mercadopago'
                      ? 'No recurrente'
                      : subscription?.cancelAtPeriodEnd
                      ? 'Finaliza al vencer'
                      : 'Automatica'}
                </Text>
              </View>
            </View>

            {!isFreeCurrentPlan && subscription?.paymentProvider === 'stripe' && subscription.status === 'active' ? (
              <TouchableOpacity
                disabled={cancelling || subscription.cancelAtPeriodEnd}
                onPress={handleCancelSubscription}
                activeOpacity={0.8}
                style={{ marginTop: 14, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: subscription.cancelAtPeriodEnd ? 'rgba(255,255,255,0.06)' : 'rgba(248,113,113,0.14)', borderWidth: 1, borderColor: subscription.cancelAtPeriodEnd ? 'rgba(255,255,255,0.1)' : 'rgba(248,113,113,0.28)' }}
              >
                <Text className="text-sm font-semibold" style={{ color: subscription.cancelAtPeriodEnd ? 'rgba(255,255,255,0.6)' : '#fecaca' }}>
                  {cancelling ? 'Cancelando...' : subscription.cancelAtPeriodEnd ? 'Renovacion cancelada' : 'Cancelar renovacion'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <Text className="text-white/80 text-sm mt-4" style={{ lineHeight: 20 }}>
              {memberLimit > 0
                ? `Este plan permite hasta ${memberLimit} miembros familiares y desbloquea sus funciones asociadas.`
                : 'Este plan no permite administrar membresías familiares.'}
            </Text>
          </LinearGradient>
        </View>

        {canManageFamily ? (
          <View className="px-4 pb-4">
            <TouchableOpacity
              onPress={() => router.push('/subscription/manage')}
              activeOpacity={0.85}
              className="rounded-2xl px-5 py-4 bg-cyan-500 flex-row items-center justify-between"
            >
              <View>
                <Text className="text-white text-base font-semibold">Administrar membresías</Text>
                <Text className="text-white/80 text-sm mt-1">
                  Agrega y quita miembros reales de tu plan familiar.
                </Text>
              </View>
              <Text className="text-white text-2xl">{'>'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View className="px-4 pb-8">
          {plans.map((plan) => (
            <PlanCard
              key={plan.slug}
              plan={plan}
              billingPeriod={billingPeriods[plan.slug] ?? 'monthly'}
              isCurrentPlan={plan.slug === currentSlug}
              onBillingChange={(period) => handleBillingChange(plan.slug, period)}
              onSubscribe={() => handleSubscribe(plan)}
            />
          ))}
        </View>

        <View className="px-4 pb-8">
          <View style={{ marginBottom: 14 }}>
            <Text className="text-white text-2xl font-bold">Lo que desbloquea tu compra</Text>
            <Text className="text-white/65 text-sm mt-2">
              Aquí se ve claramente qué queda activo y qué sigue bloqueado según el plan seleccionado.
            </Text>
          </View>

          {FEATURE_DEFINITIONS.map((feature) => {
            const available = canAccessFeature(currentSlug, feature.id);
            const requiredLabel =
              feature.minimumPlan === 'safe'
                ? 'Safe'
                : feature.minimumPlan === 'guard'
                  ? 'Guard'
                  : 'Edu';

            return (
              <FeatureAccessCard
                key={feature.id}
                title={feature.title}
                description={feature.description}
                available={available}
                requiredPlanLabel={requiredLabel}
                onPress={() => handleFeaturePress(feature.id)}
              />
            );
          })}
        </View>

        <View className="px-4 pb-10">
          <LinearGradient
            colors={['rgba(8,18,34,0.96)', 'rgba(14,37,56,0.90)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 18, borderWidth: 1, borderColor: 'rgba(120,210,255,0.14)' }}
          >
            <Text className="text-white text-xl font-bold">Aclaraciones importantes</Text>
            <Text className="text-white/70 text-sm mt-2" style={{ lineHeight: 20 }}>
              Estas notas explican el estado actual del flujo de pago y lo que todavia depende de backend o configuracion.
            </Text>

            <View style={{ marginTop: 14, gap: 14 }}>
              <View style={{ borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <Text className="text-cyan-300 text-xs tracking-widest">PROVEEDOR VISIBLE EN APP</Text>
                <Text className="text-white/88 text-sm mt-2" style={{ lineHeight: 20 }}>
                  La experiencia mostrada al usuario esta enfocada actualmente en Stripe. El checkout y la comunicacion de cobro se presentan alrededor de ese proveedor.
                </Text>
              </View>

              <View style={{ borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <Text className="text-cyan-300 text-xs tracking-widest">CANCELACION</Text>
                <Text className="text-white/88 text-sm mt-2" style={{ lineHeight: 20 }}>
                  La app ya puede mostrar el plan e iniciar la compra, pero todavia no cuenta con un flujo funcional para cancelar la suscripcion directamente desde backend.
                </Text>
              </View>

              <View style={{ borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <Text className="text-cyan-300 text-xs tracking-widest">ENTORNO PRODUCTIVO</Text>
                <Text className="text-white/88 text-sm mt-2" style={{ lineHeight: 20 }}>
                  El funcionamiento final depende de credenciales de pago validas, tablas desplegadas y una configuracion consistente entre frontend, backend y proveedor de pago.
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>
      </ScrollView>

      <StripePaymentSheet
        visible={pendingPlan !== null}
        plan={pendingPlan}
        billingPeriod={pendingPlan ? billingPeriods[pendingPlan.slug] ?? 'monthly' : 'monthly'}
        loading={sheetLoading}
        onSelect={handleSelectPaymentProvider}
        onClose={() => !sheetLoading && setPendingPlan(null)}
      />
    </SafeAreaView>
  );
}
