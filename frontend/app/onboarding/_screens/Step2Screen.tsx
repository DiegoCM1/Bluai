import React, { useEffect, useState } from 'react';
import { Alert, View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WizardContainer } from '../_components/WizardContainer';
import { FormSlider } from '../_components/FormSlider';
import { FormDropdown } from '../_components/FormDropdown';
import { useOnboarding } from '../_context/OnboardingContext';
import { validateStep2 } from '../_validation';
import { AGE_RANGES } from '../_types';
import { track } from '../../../utils/analytics';
import { useRouter } from 'expo-router';
import { colors } from '../../../utils/theme';
import { onboardingBreadcrumb, reportOnboardingFailure } from '../_services/onboardingTelemetry';

export const Step2Screen: React.FC = () => {
  const router = useRouter();
  const { data, updateField, submitOnboarding } = useOnboarding();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    onboardingBreadcrumb('step2: mounted');
  }, []);

  const handleBack = () => router.back();

  const handleFinish = async () => {
    const validation = validateStep2(data);
    const invalidFields = Object.keys(validation.errors);
    onboardingBreadcrumb('step2: finalizar tapped', { valid: validation.isValid, invalidFields });

    if (!validation.isValid) {
      reportOnboardingFailure('validation-blocked', 'step2', { fields: invalidFields }, 'warning');
      setErrors(validation.errors);
      const firstError = Object.values(validation.errors)[0];
      Alert.alert('Error de validación', firstError);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      track('onboarding_step2_completed');
      await submitOnboarding();
    } catch (error) {
      console.error('submitOnboarding failed:', error);
      Alert.alert('Error', 'Hubo un problema al guardar tu información. Por favor intenta de nuevo.');
      setIsSubmitting(false);
    }
  };

  return (
    <WizardContainer
      currentStep={2}
      totalSteps={2}
      title="Preferencias"
      subtitle="Personaliza tu experiencia con BluAI"
      onNext={handleFinish}
      onBack={handleBack}
      nextLabel="Finalizar"
      backLabel="Atrás"
      isLoading={isSubmitting}
    >
      <View className="mb-6">
        <View className="flex-row items-center mb-3">
          <MaterialCommunityIcons name="account-circle" size={24} color={colors.brandBlue} />
          <Text className="ml-2 text-lg font-semibold text-white">
            Sobre Ti
          </Text>
        </View>

        <FormDropdown
          label="¿Qué edad tienes?"
          value={data.age}
          onValueChange={(value) => updateField('age', value)}
          options={AGE_RANGES}
          placeholder="Selecciona tu rango"
          error={errors.age}
          required
        />

        <Text className="text-xs text-white/60 mt-1">
          Esto nos ayuda a personalizar las alertas según tu grupo de edad
        </Text>
      </View>

      <View className="mb-6">
        <View className="flex-row items-center mb-3">
          <MaterialCommunityIcons name="cog-outline" size={24} color={colors.brandBlue} />
          <Text className="ml-2 text-lg font-semibold text-white">
            Tus Preferencias
          </Text>
        </View>

        <View className="mb-6">
          <Text className="text-sm font-medium text-white mb-2">
            😰 Nivel de Ansiedad ante Emergencias
          </Text>
          <FormSlider
            label=""
            value={data.nervousnessLevel}
            onValueChange={(value) => updateField('nervousnessLevel', value)}
            minimumValue={1}
            maximumValue={10}
            minimumLabel="Tranquilo"
            maximumLabel="Muy nervioso"
            error={errors.nervousnessLevel}
          />
          <Text className="text-xs text-white/60 mt-1">
            Ajustaremos el tono de las alertas según tu nivel de ansiedad
          </Text>
        </View>

        <View className="mb-4">
          <Text className="text-sm font-medium text-white mb-2">
            📊 Nivel de Detalle en Información
          </Text>
          <FormSlider
            label=""
            value={data.weatherInfoLevel}
            onValueChange={(value) => updateField('weatherInfoLevel', value)}
            minimumValue={1}
            maximumValue={10}
            minimumLabel="Solo lo básico"
            maximumLabel="Todos los detalles"
            error={errors.weatherInfoLevel}
          />
          <Text className="text-xs text-white/60 mt-1">
            Define cuánta información técnica quieres recibir en las alertas
          </Text>
        </View>
      </View>

      <View className="bg-white/10 border border-white/20 rounded-lg p-4 mb-4">
        <View className="flex-row items-start">
          <MaterialCommunityIcons name="information-outline" size={20} color={colors.brandBlue} />
          <Text className="ml-2 text-xs text-white/80 flex-1">
            Estas preferencias nos ayudan a enviarte alertas más relevantes y adaptadas a ti.
            Puedes cambiarlas en cualquier momento desde Configuración.
          </Text>
        </View>
      </View>
    </WizardContainer>
  );
};
