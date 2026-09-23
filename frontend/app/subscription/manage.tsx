import '../../global.css';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { track } from '../../utils/analytics';
import MemberListItem from './_components/MemberListItem';
import { addFamilyMember, getFamilyMembers, removeFamilyMember } from './_services/subscriptionService';
import { FamilyMember, Subscription } from './_types';
import { getSubscription } from './_services/subscriptionService';
import { canAccessFeature, getCurrentPlanSlug, getMemberLimit } from './_utils/planAccess';

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  useEffect(() => {
    track('subscription_manage_view');
    void loadScreen();
  }, []);

  const loadScreen = async () => {
    try {
      const currentSubscription = await getSubscription();
      setSubscription(currentSubscription);
      const currentPlan = getCurrentPlanSlug(currentSubscription);
      if (!canAccessFeature(currentPlan, 'family_management')) {
        setMembers([]);
        setLoadError('Tu plan actual no incluye administración de membresías.');
        return;
      }
      await loadMembers();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadMembers = async () => {
    try {
      setLoadError(null);
      const membersData = await getFamilyMembers();
      setMembers(membersData);
    } catch (error) {
      console.error('Error loading members:', error);
      setLoadError('No se pudo actualizar la lista en este momento.');
    }
  };

  const handleAddMember = () => {
    track('subscription_add_member_tap');
    setShowAddModal(true);
  };

  const handleSubmitAddMember = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Correo requerido', 'Ingresa el correo de una cuenta existente en BluEye.');
      return;
    }

    try {
      setAdding(true);
      const member = await addFamilyMember(trimmed);
      setMembers((prev) => {
        if (prev.some((item) => item.id === member.id)) return prev;
        return [...prev, member];
      });
      setEmail('');
      setShowAddModal(false);
      Alert.alert('Miembro agregado', `${member.name} ya forma parte del plan familiar.`);
    } catch (error: any) {
      Alert.alert('No se pudo agregar', error?.message ?? 'Intenta de nuevo.');
    } finally {
      setAdding(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadScreen();
  };

  const handleRemoveMember = (member: FamilyMember) => {
    Alert.alert(
      'Quitar miembro',
      `Se eliminará a ${member.name} del plan familiar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFamilyMember(member.id);
              setMembers((prev) => prev.filter((item) => item.id !== member.id));
              Alert.alert('Miembro eliminado', `${member.name} ya no forma parte del plan familiar.`);
            } catch (error: any) {
              Alert.alert('No se pudo eliminar', error?.message ?? 'Intenta de nuevo.');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-transparent items-center justify-center">
        <ActivityIndicator size="large" color="rgb(50, 180, 200)" />
      </SafeAreaView>
    );
  }

  const currentPlan = getCurrentPlanSlug(subscription);
  const memberLimit = getMemberLimit(currentPlan);
  const canManageFamily = canAccessFeature(currentPlan, 'family_management');

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['left', 'right', 'bottom']}>
      <View className="flex-row items-center px-6 py-4 border-b border-gray-200">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="rgb(50, 180, 200)" />
        </TouchableOpacity>
        <Ionicons name="people" size={28} color="rgb(50, 180, 200)" />
        <Text className="text-2xl font-bold text-phase2Titles ml-2">
          Suscripción
        </Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {refreshing ? (
          <View className="px-6 pt-4">
            <View className="rounded-2xl px-4 py-3 bg-cyan-500/10 border border-cyan-400/20 flex-row items-center">
              <ActivityIndicator size="small" color="rgb(50, 180, 200)" />
              <Text className="text-white ml-3">
                Actualizando miembros...
              </Text>
            </View>
          </View>
        ) : null}

        <View className="px-6 py-6">
          <View className="rounded-2xl p-6 relative overflow-hidden" style={{ backgroundColor: '#60A5FA' }}>
            <View className="absolute right-0 top-0 opacity-20">
              <Ionicons name="people" size={120} color="white" />
            </View>

            <View className="relative z-10">
              <Text className="text-white text-2xl font-bold mb-2">
                Plan familiar
              </Text>
              <Text className="text-white text-base mb-4">
                {members.length} personas agregadas de {memberLimit || 0} permitidas
              </Text>

              <TouchableOpacity
                onPress={handleAddMember}
                disabled={!canManageFamily}
                className="self-start bg-white rounded-full px-4 py-2 flex-row items-center"
                activeOpacity={0.8}
              >
                <Text className="text-phase2Buttons font-semibold mr-1">
                  Añadir
                </Text>
                <Ionicons name="chevron-forward" size={16} color="rgb(50, 180, 200)" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleRefresh}
                disabled={refreshing}
                className="self-start mt-3 bg-white/20 rounded-full px-4 py-2 flex-row items-center"
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={16} color="white" />
                <Text className="text-white font-semibold ml-2">
                  {refreshing ? 'Actualizando...' : 'Actualizar lista'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View className="px-6 pb-8">
          {loadError ? (
            <View className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-3">
              <Text className="text-amber-900 font-semibold mb-1">
                No se pudo sincronizar
              </Text>
              <Text className="text-amber-800 text-sm">
                {loadError}
              </Text>
            </View>
          ) : null}

          {!canManageFamily ? (
            <View className="bg-white rounded-xl px-5 py-6">
              <Text className="text-base font-semibold text-phase2Titles mb-2">
                Membresías bloqueadas
              </Text>
              <Text className="text-sm text-phase2SecondaryTxt">
                Activa Safe o Guard para administrar miembros familiares.
              </Text>
            </View>
          ) : members.length > 0 ? (
            members.map((member) => (
              <MemberListItem
                key={member.id}
                member={member}
                onRemove={handleRemoveMember}
              />
            ))
          ) : (
            <View className="bg-white rounded-xl px-5 py-6">
              <Text className="text-base font-semibold text-phase2Titles mb-2">
                Aún no hay miembros agregados
              </Text>
              <Text className="text-sm text-phase2SecondaryTxt">
                Agrega por correo a personas que ya tengan una cuenta registrada para empezar a compartir ubicación.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!adding) setShowAddModal(false);
        }}
      >
        <View className="flex-1 bg-black/45 justify-end">
          <View className="bg-white rounded-t-3xl px-6 pt-6 pb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-2xl font-bold text-phase2Titles">
                Añadir miembro
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!adding) setShowAddModal(false);
                }}
              >
                <Ionicons name="close" size={24} color="#334155" />
              </TouchableOpacity>
            </View>

            <Text className="text-sm text-phase2SecondaryTxt mb-3">
              Ingresa el correo de una persona que ya tenga cuenta en BluEye.
            </Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="correo@ejemplo.com"
              placeholderTextColor="#94A3B8"
              className="border border-slate-200 rounded-2xl px-4 py-3 text-base text-slate-800"
            />

            <TouchableOpacity
              onPress={handleSubmitAddMember}
              disabled={adding}
              className={`mt-5 rounded-2xl px-4 py-4 items-center ${adding ? 'bg-slate-300' : 'bg-cyan-500'}`}
              activeOpacity={0.85}
            >
              <Text className="text-white text-base font-semibold">
                {adding ? 'Agregando...' : 'Agregar al plan'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
