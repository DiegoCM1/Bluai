import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { BillingPeriod, PaymentProvider, Plan } from '../_types';
import { colors, fonts } from '../../../utils/theme';

interface Props {
  visible: boolean;
  plan: Plan | null;
  billingPeriod: BillingPeriod;
  loading: boolean;
  onSelect: (provider: PaymentProvider) => void;
  onClose: () => void;
}

export default function PaymentMethodSheet({
  visible,
  plan,
  billingPeriod,
  loading,
  onSelect,
  onClose,
}: Props) {
  if (!plan) return null;

  const price = billingPeriod === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
  const periodLabel = billingPeriod === 'monthly' ? '/mes' : '/año';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>Pagar con Stripe</Text>
          <Text style={styles.subtitle}>
            {plan.name} · <Text style={{ color: colors.brandCyan }}>${price?.toFixed(2)}{periodLabel}</Text>
          </Text>

          <View style={styles.methods}>
            <TouchableOpacity
              onPress={() => !loading && onSelect('stripe')}
              activeOpacity={0.75}
              style={[
                styles.methodCard,
                { borderColor: '#635BFF55', backgroundColor: '#635BFF12' },
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: '#635BFF22' }]}>
                <MaterialCommunityIcons name="credit-card-outline" size={24} color="#635BFF" />
              </View>

              <View style={styles.methodText}>
                <Text style={styles.methodName}>Stripe</Text>
                <Text style={styles.methodDesc}>Tarjeta de crédito o débito</Text>
              </View>

              <MaterialCommunityIcons
                name={loading ? 'dots-horizontal' : 'chevron-right'}
                size={20}
                color="rgba(255,255,255,0.26)"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <Text style={styles.helperText}>
            El pago y la renovación se gestionan directamente en Stripe.
          </Text>

          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#070e1c',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.square721,
    color: 'white',
    fontSize: 22,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
    marginBottom: 24,
  },
  methods: {
    gap: 12,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 16,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  methodText: {
    flex: 1,
  },
  methodName: {
    fontFamily: fonts.poppinsSemiBold,
    color: 'white',
    fontSize: 16,
  },
  methodDesc: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.46)',
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 20,
    marginBottom: 14,
  },
  helperText: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    lineHeight: 18,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  cancelText: {
    fontFamily: fonts.poppins,
    color: 'rgba(255,255,255,0.38)',
    fontSize: 14,
  },
});
