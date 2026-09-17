import { View, Text, TouchableOpacity } from 'react-native';
import { BillingPeriod, Plan } from '../_types';
import { colors, fonts } from '../../../utils/theme';

interface BillingToggleProps {
  plan: Plan;
  billingPeriod: BillingPeriod;
  onBillingChange: (period: BillingPeriod) => void;
}

export default function BillingToggle({ plan, billingPeriod, onBillingChange }: BillingToggleProps) {
  const isMonthly = billingPeriod === 'monthly';
  const isAnnual = billingPeriod === 'annual';

  const monthlyLabel = plan.monthlyPrice != null ? `$${plan.monthlyPrice.toFixed(2)}` : 'Gratis';
  const annualLabel = plan.annualPrice != null ? `$${plan.annualPrice.toFixed(2)}` : 'Gratis';

  return (
    <View style={{ flexDirection: 'row' }}>
      {/* Monthly */}
      <TouchableOpacity
        onPress={() => onBillingChange('monthly')}
        activeOpacity={0.7}
        style={{
          flex: 1,
          marginRight: 8,
          padding: 14,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: isMonthly ? colors.brandBlue : 'rgba(255,255,255,0.2)',
          backgroundColor: isMonthly ? `${colors.brandBlue}18` : 'transparent',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <View style={{
            width: 18, height: 18, borderRadius: 9, borderWidth: 2,
            borderColor: isMonthly ? colors.brandBlue : 'rgba(255,255,255,0.4)',
            backgroundColor: isMonthly ? colors.brandBlue : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {isMonthly && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: 'white' }} />}
          </View>
        </View>
        <Text style={{ fontFamily: fonts.poppinsSemiBold, color: 'white', fontSize: 20 }}>
          {monthlyLabel}
        </Text>
        <Text style={{ fontFamily: fonts.poppins, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          Facturación mensual
        </Text>
      </TouchableOpacity>

      {/* Annual */}
      <TouchableOpacity
        onPress={() => onBillingChange('annual')}
        activeOpacity={0.7}
        style={{
          flex: 1,
          marginLeft: 8,
          padding: 14,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: isAnnual ? colors.brandBlue : 'rgba(255,255,255,0.2)',
          backgroundColor: isAnnual ? `${colors.brandBlue}18` : 'transparent',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <View style={{
            width: 18, height: 18, borderRadius: 9, borderWidth: 2,
            borderColor: isAnnual ? colors.brandBlue : 'rgba(255,255,255,0.4)',
            backgroundColor: isAnnual ? colors.brandBlue : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {isAnnual && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: 'white' }} />}
          </View>
          {plan.annualDiscount > 0 && (
            <View style={{ backgroundColor: `${colors.brandBlue}30`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
              <Text style={{ fontFamily: fonts.poppinsSemiBold, color: colors.brandCyan, fontSize: 11 }}>
                Ahorra {plan.annualDiscount}%
              </Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: fonts.poppinsSemiBold, color: 'white', fontSize: 20 }}>
          {annualLabel}
        </Text>
        <Text style={{ fontFamily: fonts.poppins, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          Facturación anual
        </Text>
      </TouchableOpacity>
    </View>
  );
}
