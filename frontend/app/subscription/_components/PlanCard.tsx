import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Plan, BillingPeriod } from '../_types';
import FeatureList from './FeatureList';
import { fonts } from '../../../utils/theme';

const PLAN_ACCENT: Record<string, { color: string; glow: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  free: { color: '#38BDF8', glow: '#0b2e48', icon: 'shield-outline' },
  safe: { color: '#4F7CFF', glow: '#1b2b75', icon: 'shield-home-outline' },
  guard: { color: '#9B5CFF', glow: '#3a195f', icon: 'shield-star-outline' },
  edu: { color: '#14D68A', glow: '#123f35', icon: 'school-outline' },
};

interface PlanCardProps {
  plan: Plan;
  billingPeriod: BillingPeriod;
  isCurrentPlan: boolean;
  onBillingChange: (period: BillingPeriod) => void;
  onSubscribe: () => void;
}

export default function PlanCard({
  plan,
  isCurrentPlan,
  onSubscribe,
}: PlanCardProps) {
  const accent = PLAN_ACCENT[plan.slug] ?? PLAN_ACCENT.free;
  const canSubscribe = !plan.isFree && !isCurrentPlan;
  const ctaLabel = isCurrentPlan ? 'Plan actual' : plan.isFree ? 'Plan incluido' : 'Ver en el sitio web';
  const priceLabel = plan.isFree ? 'Sin costo' : 'Precios en la web';

  return (
    <View
      style={[
        styles.card,
        { borderColor: isCurrentPlan ? `${accent.color}66` : `${accent.color}30` },
      ]}
    >
      <LinearGradient
        colors={['rgba(6,14,28,0.98)', accent.glow, 'rgba(4,10,20,0.98)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientFill}
      >
        <View style={styles.topRow}>
          <View
            style={[
              styles.planPill,
              { backgroundColor: `${accent.color}22`, borderColor: `${accent.color}44` },
            ]}
          >
            <MaterialCommunityIcons name={accent.icon} size={14} color={accent.color} />
            <Text style={[styles.planPillText, { color: accent.color }]}>
              {plan.isFree ? 'Base' : 'Premium'}
            </Text>
          </View>

          {isCurrentPlan ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: `${accent.color}1e`, borderColor: `${accent.color}48` },
              ]}
            >
              <Text style={[styles.badgeText, { color: accent.color }]}>Activo ahora</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.header}>
          <View
            style={[
              styles.iconBox,
              { backgroundColor: `${accent.color}16`, borderColor: `${accent.color}34` },
            ]}
          >
            <MaterialCommunityIcons name={accent.icon} size={22} color={accent.color} />
          </View>

          <View style={styles.headerText}>
            <Text style={styles.planName}>{plan.name}</Text>
            <Text style={styles.planDesc}>{plan.description}</Text>
          </View>
        </View>

        <View
          style={[
            styles.priceBand,
            { borderColor: `${accent.color}2f`, backgroundColor: `${accent.color}12` },
          ]}
        >
          <Text style={styles.priceCaption}>Plan seleccionado</Text>
          <Text style={styles.priceValue}>{priceLabel}</Text>
          <Text style={styles.priceFoot}>
            {plan.isFree ? 'Acceso esencial para uso individual.' : 'Elige tu periodo y paga en el sitio de Bluai.'}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: `${accent.color}22` }]} />

        <FeatureList features={plan.features} title="INCLUYE:" />


        <TouchableOpacity
          onPress={canSubscribe ? onSubscribe : undefined}
          activeOpacity={canSubscribe ? 0.85 : 1}
          style={styles.ctaWrap}
        >
          <LinearGradient
            colors={
              canSubscribe
                ? [accent.color, '#56CCF2']
                : ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              styles.cta,
              !canSubscribe && { borderWidth: 1, borderColor: `${accent.color}26` },
            ]}
          >
            <Text
              style={[
                styles.ctaText,
                { color: canSubscribe ? 'white' : 'rgba(255,255,255,0.56)' },
              ]}
            >
              {ctaLabel}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 18,
    overflow: 'hidden',
  },
  gradientFill: {
    padding: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  planPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  planPillText: {
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  iconBox: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: 14,
  },
  planName: {
    fontFamily: fonts.poppinsSemiBold,
    color: 'white',
    fontSize: 24,
    marginBottom: 4,
  },
  planDesc: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    lineHeight: 18,
  },
  priceBand: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  priceCaption: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.58)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  priceValue: {
    fontFamily: fonts.poppinsSemiBold,
    color: 'white',
    fontSize: 24,
    marginTop: 4,
  },
  priceFoot: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    marginTop: 4,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 11,
  },
  divider: {
    height: 1,
    marginBottom: 16,
  },
  billingWrap: {
    marginTop: 16,
  },
  ctaWrap: {
    marginTop: 18,
  },
  cta: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: fonts.poppinsSemiBold,
    fontSize: 15,
    letterSpacing: 0.8,
  },
});
