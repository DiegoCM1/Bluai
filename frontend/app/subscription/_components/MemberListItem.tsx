import { TouchableOpacity, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FamilyMember } from '../_types';

interface MemberListItemProps {
  member: FamilyMember;
  onRemove?: (member: FamilyMember) => void;
}

export default function MemberListItem({ member, onRemove }: MemberListItemProps) {
  const distanceText =
    member.distanceUnit === 'km'
      ? `${member.distance} km`
      : `${member.distance} mts`;

  return (
    <View className="flex-row items-center px-6 py-4 bg-white mb-2 rounded-xl">
      {/* Avatar */}
      <View
        className="w-12 h-12 rounded-full items-center justify-center mr-4"
        style={{ backgroundColor: member.avatarColor }}
      >
        <Text className="text-white text-lg font-bold">{member.initials}</Text>
      </View>

      {/* Name */}
      <Text className="flex-1 text-lg font-semibold text-phase2Titles">
        {member.name}
      </Text>

      {/* Distance */}
      <Text className="text-base text-phase2SecondaryTxt">
        {distanceText}
      </Text>

      {onRemove ? (
        <TouchableOpacity
          onPress={() => onRemove(member)}
          className="ml-4 h-10 w-10 items-center justify-center rounded-full bg-red-50"
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={18} color="#DC2626" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
