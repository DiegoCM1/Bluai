import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface FeatureAccessCardProps {
  title: string;
  description: string;
  available: boolean;
  requiredPlanLabel: string;
  onPress?: () => void;
}

export default function FeatureAccessCard({
  title,
  description,
  available,
  requiredPlanLabel,
  onPress,
}: FeatureAccessCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.touch}>
      <LinearGradient
        colors={
          available
            ? ['rgba(16,53,45,0.94)', 'rgba(7,25,26,0.98)']
            : ['rgba(72,45,14,0.94)', 'rgba(28,18,11,0.98)']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.card,
          available ? styles.cardAvailable : styles.cardLocked,
        ]}
      >
        <View style={styles.iconBox}>
          <MaterialCommunityIcons
            name={available ? 'check-decagram-outline' : 'lock-outline'}
            size={22}
            color={available ? '#34D399' : '#F59E0B'}
          />
        </View>

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <View style={[styles.badge, available ? styles.badgeOk : styles.badgeLocked]}>
              <Text style={styles.badgeText}>
                {available ? 'Activo' : `Requiere ${requiredPlanLabel}`}
              </Text>
            </View>
          </View>

          <Text style={styles.description}>{description}</Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touch: {
    marginBottom: 12,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    borderWidth: 1,
  },
  cardAvailable: {
    borderColor: 'rgba(34,197,94,0.24)',
  },
  cardLocked: {
    borderColor: 'rgba(245,158,11,0.22)',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    color: 'white',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeOk: {
    backgroundColor: 'rgba(34,197,94,0.16)',
  },
  badgeLocked: {
    backgroundColor: 'rgba(245,158,11,0.18)',
  },
  badgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  description: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    lineHeight: 18,
  },
});
