import React from 'react';
import { Pressable } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { styles } from './styles';

type MenuItemProps = {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  label: string;
  hint?: string;
  color?: string;
  indent?: boolean;
  onPress?: () => void;
};

export default function MenuItem({ icon, label, hint, color, indent, onPress }: MenuItemProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <Pressable style={[styles.menuItem, indent && { paddingLeft: 32 }]} onPress={onPress}>
      <FontAwesome name={icon} size={18} color={color ?? Colors.primary} style={styles.menuIcon} />
      <Text style={styles.menuLabel}>{label}</Text>
      {hint ? (
        <Text style={[styles.menuHint, { color: colors.textSecondary }]}>{hint}</Text>
      ) : null}
      <FontAwesome name="chevron-right" size={12} color={colors.text} style={{ opacity: 0.3 }} />
    </Pressable>
  );
}
