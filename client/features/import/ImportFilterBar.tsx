import React from 'react';
import { StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { ImportFilters } from '@/services/importService';

type FilterState = {
  direction: string | null;
  paymentMethod: string | null;
};

type Props = {
  filters: ImportFilters;
  value: FilterState;
  onChange: (value: FilterState) => void;
};

export default function ImportFilterBar({ filters, value, onChange }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const renderChip = (
    label: string,
    isActive: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      style={[
        s.chip,
        {
          borderColor: isActive ? Colors.primary : colors.border,
          backgroundColor: isActive ? Colors.primary + '12' : 'transparent',
        },
      ]}
      onPress={onPress}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: isActive ? '600' : '400',
          color: isActive ? Colors.primary : colors.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={s.container}>
      {/* Direction filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        <Text style={[s.label, { color: colors.textSecondary }]}>收/支</Text>
        {renderChip('全部', value.direction === null, () =>
          onChange({ ...value, direction: null })
        )}
        {filters.directions.map((d) =>
          renderChip(d, value.direction === d, () =>
            onChange({ ...value, direction: d })
          )
        )}
      </ScrollView>

      {/* Payment method filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        <Text style={[s.label, { color: colors.textSecondary }]}>支付方式</Text>
        {renderChip('全部', value.paymentMethod === null, () =>
          onChange({ ...value, paymentMethod: null })
        )}
        {filters.payment_methods.map((m) =>
          renderChip(m, value.paymentMethod === m, () =>
            onChange({ ...value, paymentMethod: m })
          )
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: 8,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    marginRight: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
  },
});
