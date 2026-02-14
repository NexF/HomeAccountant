import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { BudgetResponse } from '@/services/budgetService';

const STATUS_COLORS: Record<string, string> = {
  normal: Colors.asset,
  warning: '#F59E0B',
  exceeded: '#EF4444',
};

type Props = {
  budget: BudgetResponse;
  onPress?: (budget: BudgetResponse) => void;
  onLongPress?: (budget: BudgetResponse) => void;
};

export default function BudgetCard({ budget, onPress, onLongPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const statusColor = STATUS_COLORS[budget.status] ?? colors.textSecondary;
  const pct = Math.min(budget.usage_rate, 1) * 100;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => onPress?.(budget)}
      onLongPress={() => onLongPress?.(budget)}
    >
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 10 }}>
        {budget.account_name ?? '总预算'}
      </Text>
      <View style={styles.row}>
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
            预算额度
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
            ¥{budget.amount.toLocaleString()}
          </Text>
        </View>
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
            本月已用
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: statusColor }}>
            ¥{budget.used_amount.toLocaleString()}
          </Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: statusColor }}>
          {Math.round(budget.usage_rate * 100)}%
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.bar, { width: `${pct}%`, backgroundColor: statusColor }]} />
      </View>
      <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6 }}>
        提醒阈值：{Math.round(budget.alert_threshold * 100)}% · 点击编辑 · 长按删除
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
});
