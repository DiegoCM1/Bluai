import React, { ReactNode, RefObject } from 'react';
import {
  View,
  Text,
  ScrollView,
  Platform,
  TouchableOpacity,
} from 'react-native';
// keyboard-controller's version, not RN's: it measures the keyboard against the app
// window, which RN's gets wrong when an iPhone-only app runs scaled on an iPad — the
// footer button could end up under the keyboard (App Review, build 19).
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProgressIndicator } from './ProgressIndicator';

interface WizardContainerProps {
  currentStep: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  isLoading?: boolean;
  /** Lets a step scroll to its first invalid field. */
  scrollRef?: RefObject<ScrollView | null>;
}

export const WizardContainer: React.FC<WizardContainerProps> = ({
  currentStep,
  totalSteps,
  title,
  subtitle,
  children,
  onNext,
  onBack,
  nextLabel = 'Continuar',
  backLabel = 'Atrás',
  nextDisabled = false,
  isLoading = false,
  scrollRef,
}) => {
  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View className="border-b border-white/20">
          <ProgressIndicator totalSteps={totalSteps} currentStep={currentStep} />
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 px-6"
          contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-6">
            <Text className="text-2xl font-bold text-white mb-2">
              {title}
            </Text>
            {subtitle && (
              <Text className="text-base text-white/70">
                {subtitle}
              </Text>
            )}
          </View>

          {children}
        </ScrollView>

        <View className="px-6 py-4 border-t border-white/20">
          <View className="flex-row gap-3">
            {onBack && (
              <TouchableOpacity
                onPress={onBack}
                disabled={isLoading}
                className="flex-1 py-4 bg-white/20 rounded-lg items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={backLabel}
              >
                <Text className="text-base font-semibold text-white">
                  {backLabel}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={onNext}
              disabled={nextDisabled || isLoading}
              className={`py-4 rounded-lg items-center justify-center ${
                onBack ? 'flex-1' : 'w-full'
              } ${
                nextDisabled || isLoading
                  ? 'bg-white/20'
                  : 'bg-brand-blue'
              }`}
              accessibilityRole="button"
              accessibilityLabel={nextLabel}
              accessibilityState={{ disabled: nextDisabled || isLoading }}
            >
              <Text
                className={`text-base font-semibold ${
                  nextDisabled || isLoading ? 'text-white/50' : 'text-white'
                }`}
              >
                {isLoading ? 'Cargando...' : nextLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
