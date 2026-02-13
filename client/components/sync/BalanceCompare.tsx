import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  bookBalance: number;
  externalBalance: number;
  difference: number;
};

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-¥${s}` : `¥${s}`;
}

export default function BalanceCompare({ bookBalance, externalBalance, difference }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const diffColor = difference === 0
    ? Colors.liability
    : difference > 0
      ? Colors.asset
      : Colors.liability;

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>账本余额</Text>
          <Text style={[styles.value, { color: colors.text }]}>{fmt(bookBalance)}</Text>
        </View>
        <View style={styles.arrowCol}>
          <FontAwesome name="exchange" size={14} color={colors.textSecondary} />
        </View>
        <View style={styles.col}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>真实余额</Text>
          <Text style={[styles.value, { color: colors.text }]}>{fmt(externalBalance)}</Text>
        </View>
      </View>
      <View style={[styles.diffRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.diffLabel, { color: colors.textSecondary }]}>差异</Text>
        <Text style={[styles.diffValue, { color: diffColor }]}>
          {difference > 0 ? '+' : ''}{fmt(difference)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'transparent',
  },
  col: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  arrowCol: {
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  diffRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  diffLabel: {
    fontSize: 13,
  },
  diffValue: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
