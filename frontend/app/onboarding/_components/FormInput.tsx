import React, { useState } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';

interface FormInputProps extends TextInputProps {
  label: string;
  error?: string;
  required?: boolean;
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  error,
  required = false,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'words',
  ...rest
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-white mb-2">
        {label}
        {required && <Text className="text-red-400"> *</Text>}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.4)"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`px-4 py-3 rounded-lg text-base text-white ${
          error
            ? 'border-2 border-red-400 bg-red-500/20'
            : isFocused
            ? 'border-2 border-brand-blue bg-white/20'
            : 'border border-white/30 bg-white/10'
        }`}
        accessibilityLabel={label}
        accessibilityHint={placeholder}
        {...rest}
      />

      {error && (
        <Text className="text-sm text-red-400 mt-1">
          {error}
        </Text>
      )}
    </View>
  );
};
