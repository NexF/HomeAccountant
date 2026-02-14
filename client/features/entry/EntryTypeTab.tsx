import React from 'react';
import { StyleSheet, Pressable, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { EntryType } from '@/services/entryService';

export type EntryTypeConfig = {
  key: EntryType;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
};

export const ENTRY_TYPES: EntryTypeConfig[] = [
  { key: 'expense', label: '费用', icon: 'shopping-cart', color: '#8B5CF6' },
  { key: 'income', label: '收入', icon: 'dollar', color: Colors.asset },
  { key: 'asset_purchase', label: '购买资产', icon: 'building', color: '#F59E0B' },
  { key: 'borrow', label: '借入', icon: 'hand-o-right', color: Colors.liability },
  { key: 'repay', label: '还款', icon: 'credit-card', color: '#06B6D4' },
  { key: 'transfer', label: '转账', icon: 'exchange', color: Colors.neutral },
];

type Props = {
  activeType: EntryType;
  onTypeChange: (type: EntryType) => void;
  disabled?: boolean;
};

export default function EntryTypeTab({ activeType, onTypeChange, disabled }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {ENTRY_TYPES.map((t) => {
        const active = activeType === t.key;
        return (
          <Pressable
            key={t.key}
            disabled={disabled}
            style={[
              styles.tab,
              active && { backgroundColor: t.color + '18', borderColor: t.color },
              disabled && !active && styles.tabLocked,
            ]}
            onPress={() => !disabled && onTypeChange(t.key)}
          >
            <FontAwesome
              name={t.icon}
              size={14}
              color={active ? t.color : disabled ? colors.textSecondary + '60' : colors.textSecondary}
              style={styles.icon}
            />
            <Text
              style={[
                styles.label,
                { color: active ? t.color : disabled ? colors.textSecondary + '60' : colors.textSecondary },
                active && styles.labelActive,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  icon: {
    marginRight: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '600',
  },
  tabLocked: {
    opacity: 0.4,
  },
});
