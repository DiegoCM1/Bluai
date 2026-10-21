import React, { useEffect, useRef, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, ActivityIndicator, Keyboard, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { WizardContainer } from '../_components/WizardContainer';
import { FormInput } from '../_components/FormInput';
import { FormDropdown } from '../_components/FormDropdown';
import { useOnboarding } from '../_context/OnboardingContext';
import { validateStep1 } from '../_validation';
import { MEXICO_STATES } from '../_types';
import { track } from '../../../utils/analytics';
import { syncLocationToBackend } from '../../../utils/locationSync';
import { colors } from '../../../utils/theme';
import { onboardingBreadcrumb, reportOnboardingFailure } from '../_services/onboardingTelemetry';

export const Step1Screen: React.FC = () => {
  const router = useRouter();
  const { data, updateField, updateMultipleFields } = useOnboarding();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [stateHint, setStateHint] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // y of the location section inside the ScrollView — every field that can fail
  // validation lives there, so a failed "Continuar" scrolls to it.
  const locationSectionY = useRef(0);

  useEffect(() => {
    onboardingBreadcrumb('step1: mounted');
  }, []);

  const handleUseLocation = async () => {
    setIsLoadingLocation(true);

    try {
      const existingStatus = await Location.getForegroundPermissionsAsync();
      let status = existingStatus.status;

      if (status !== 'granted') {
        const permissionResponse = await Location.requestForegroundPermissionsAsync();
        status = permissionResponse.status;
      }

      if (status !== 'granted') {
        const canAskAgain = existingStatus.canAskAgain;

        if (canAskAgain) {
          Alert.alert(
            'Permisos necesarios',
            'Por favor acepta el permiso de ubicación en el siguiente cuadro de diálogo.'
          );
        } else {
          Alert.alert(
            'Permisos denegados',
            'Los permisos de ubicación fueron denegados. Ve a Configuración de la app para habilitarlos.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Ir a Configuración', onPress: () => {} }
            ]
          );
        }

        setIsLoadingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const addresses = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const address = addresses[0];

      if (address) {
        const updates: any = {};

        // Only accept a region that is actually in the list. Outside Mexico (App
        // Review tests from the US) the region would be an unselectable value.
        const region = address.region ?? '';
        if ((MEXICO_STATES as readonly string[]).includes(region)) {
          updates.state = region;
          setStateHint(null);
        } else {
          setStateHint('Bluai cubre estados de México. Selecciona el más cercano o "Fuera de México".');
        }
        if (address.postalCode) updates.zipCode = address.postalCode;
        if (address.street && address.streetNumber) {
          updates.address1 = `${address.street} ${address.streetNumber}`;
        } else if (address.street) {
          updates.address1 = address.street;
        }

        updateMultipleFields(updates);

        syncLocationToBackend(location.coords.latitude, location.coords.longitude);
        track('onboarding_location_used', {
          state: address.region,
          hasPostalCode: !!address.postalCode,
        });
      } else {
        console.warn('reverseGeocodeAsync returned no results for obtained coordinates');
        Alert.alert('Error', 'No pudimos obtener los detalles de tu ubicación.');
      }
    } catch (error: any) {
      console.error('handleUseLocation failed:', error.message, error.code);
      Alert.alert(
        'Error',
        `No pudimos obtener tu ubicación: ${error.message || 'Error desconocido'}`
      );
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const handleNext = () => {
    // A number-pad keyboard has no return key; dismiss it so it can't sit over the
    // footer or eat the next tap.
    Keyboard.dismiss();
    const validation = validateStep1(data);
    const invalidFields = Object.keys(validation.errors);
    onboardingBreadcrumb('step1: continuar tapped', { valid: validation.isValid, invalidFields });

    if (!validation.isValid) {
      setErrors(validation.errors);
      track('onboarding_step1_blocked', { fields: invalidFields });
      reportOnboardingFailure('validation-blocked', 'step1', { fields: invalidFields }, 'warning');
      // Bring the invalid field into view — an error on a field scrolled off-screen
      // is how a tap reads as "nothing happened".
      scrollRef.current?.scrollTo({ y: locationSectionY.current, animated: true });
      const firstError = Object.values(validation.errors)[0];
      Alert.alert('Falta un dato', firstError);
      return;
    }

    setErrors({});
    track('onboarding_step1_completed', {
      has_address2: !!data.address2,
    });
    onboardingBreadcrumb('step1: → step2');
    router.push('/onboarding/step2');
  };

  return (
    <WizardContainer
      currentStep={1}
      totalSteps={2}
      title="Información Personal"
      subtitle="Ayúdanos a conocerte mejor para brindarte alertas más precisas"
      onNext={handleNext}
      nextLabel="Continuar"
      scrollRef={scrollRef}
    >
      <View className="mb-6">
        <View className="flex-row items-center mb-3">
          <MaterialCommunityIcons name="account-circle" size={24} color={colors.brandBlue} />
          <Text className="ml-2 text-lg font-poppins-semibold text-white">
            Datos Personales
          </Text>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormInput
              label="Nombre (opcional)"
              value={data.firstName}
              onChangeText={(value) => updateField('firstName', value)}
              placeholder="Juan"
              error={errors.firstName}
              autoComplete="given-name"
              textContentType="givenName"
            />
          </View>

          <View className="flex-1">
            <FormInput
              label="Apellido (opcional)"
              value={data.lastName}
              onChangeText={(value) => updateField('lastName', value)}
              placeholder="Hernández"
              error={errors.lastName}
              autoComplete="family-name"
              textContentType="familyName"
            />
          </View>
        </View>

        <FormInput
          label="Teléfono (opcional)"
          value={data.phone ?? ''}
          onChangeText={(value) => updateField('phone', value)}
          placeholder="+52 999 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={30}
        />

        <Text className="text-xs text-white/60 mt-1">
          Usaremos tu nombre para personalizar las alertas. El teléfono permite recibir invitaciones SOS.
        </Text>
      </View>

      <View
        className="mb-6"
        onLayout={(e) => {
          locationSectionY.current = e.nativeEvent.layout.y;
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="map-marker" size={24} color={colors.brandBlue} />
            <Text className="ml-2 text-lg font-poppins-semibold text-white">
              Tu Ubicación
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleUseLocation}
            disabled={isLoadingLocation}
            className="flex-row items-center bg-brand-blue px-3 py-2 rounded-lg"

          >
            {isLoadingLocation ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="navigation" size={16} color="#fff" />
                <Text className="ml-1 text-xs font-semibold text-white">
                  Usar mi ubicación
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <FormInput
          label="Dirección (opcional)"
          value={data.address1}
          onChangeText={(value) => updateField('address1', value)}
          placeholder="Av. Insurgentes Sur 1234"
          error={errors.address1}
          autoComplete="street-address"
          textContentType="streetAddressLine1"
          autoCapitalize="words"
        />

        <FormInput
          label="Dirección 2 (Opcional)"
          value={data.address2}
          onChangeText={(value) => updateField('address2', value)}
          placeholder="Depto 5B, Col. Del Valle"
          autoComplete="street-address"
          textContentType="streetAddressLine2"
          autoCapitalize="words"
        />

        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormInput
              label="C.P. (opcional)"
              value={data.zipCode}
              onChangeText={(value) => updateField('zipCode', value)}
              placeholder="01000"
              error={errors.zipCode}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              autoComplete="postal-code"
              textContentType="postalCode"
              maxLength={5}
            />
          </View>

          <View className="flex-1">
            <FormDropdown
              label="Estado"
              value={data.state}
              onValueChange={(value) => {
                updateField('state', value);
                setStateHint(null);
              }}
              options={MEXICO_STATES}
              placeholder="Selecciona"
              error={errors.state}
              required
            />
          </View>
        </View>

        {stateHint && (
          <Text className="text-xs text-brand-yellow mt-1">{stateHint}</Text>
        )}

        <Text className="text-xs text-white/60 mt-1">
          Solo el estado es obligatorio. Con él te enviamos alertas relevantes de tu zona.
        </Text>
      </View>
    </WizardContainer>
  );
};
