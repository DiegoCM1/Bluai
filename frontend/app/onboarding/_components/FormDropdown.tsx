import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface FormDropdownProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  error?: string;
  required?: boolean;
}

export const FormDropdown: React.FC<FormDropdownProps> = ({
  label,
  value,
  onValueChange,
  options,
  placeholder = 'Selecciona una opción',
  error,
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue);
    setIsOpen(false);
  };

  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-white mb-2">
        {label}
        {required && <Text className="text-red-400"> *</Text>}
      </Text>

      <TouchableOpacity
        onPress={() => setIsOpen(true)}
        className={`px-4 py-3 rounded-lg flex-row items-center justify-between ${
          error
            ? 'border-2 border-red-400 bg-red-500/20'
            : 'border border-white/30 bg-white/10'
        }`}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityHint="Abre el selector de opciones"
      >
        <Text className={value ? 'text-base text-white' : 'text-base text-white/40'}>
          {value || placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>

      {error && (
        <Text className="text-sm text-red-400 mt-1">
          {error}
        </Text>
      )}

      <Modal
        visible={isOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          className="flex-1 justify-end bg-black/50"
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          <View className="bg-white rounded-t-3xl max-h-96">
            <View className="flex-row items-center justify-between px-6 py-4 border-b border-gray-200">
              <Text className="text-lg font-semibold text-gray-900">
                {label}
              </Text>
              <TouchableOpacity onPress={() => setIsOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => handleSelect(item)}
                  className="px-6 py-4 border-b border-gray-100"
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className={`text-base ${
                        item === value
                          ? 'font-semibold text-brand-blue'
                          : 'text-gray-900'
                      }`}
                    >
                      {item}
                    </Text>
                    {item === value && (
                      <MaterialCommunityIcons name="check" size={20} color="rgb(50, 180, 200)" />
                    )}
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
