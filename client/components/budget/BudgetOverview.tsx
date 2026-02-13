import React, { useEffect } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBudgetStore } from '@/stores/budgetStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';

const STATUS_COLORS: Record<string, string> = {
  normal: Colors.asset,
  warning: '#F59E0B',
  exceeded: '#EF4444',
  not_set: '#9CA3AF',
};

type Props = {
  bookId: string | undefined;
  onPress?: () => void;
};

export default function BudgetOverview({ bookId, onPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { overview, fetchOverview } = useBudgetStore();

  useEffect(() => {
    if (bookId) fetchOverview(bookId);
  }, [bookId]);

  if (!overview || overview.total_status === 'not_set') {
    return (
      <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={onPress}>
        <Text style={[styles.title, { color: colors.text }]}>费用预算</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          尚未设置预算，点击前往设置
        </Text>
      </Pressable>
    );
  }

  const statusColor = STATUS_COLORS[overview.total_status] ?? colors.textSecondary;
  const pct = Math.min((overview.total_usage_rate ?? 0), 1) * 100;
  const warningBudgets = overview.category_budgets.filter(
    (b) => b.status === 'warning' || b.status === 'exceeded'
  );

  return (
    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={onPress}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>费用预算</Text>
        <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
      </View>

      <View style={styles.amounts}>
        <Text style={[styles.used, { color: colors.text }]}>
          ¥{overview.total_used.toLocaleString()}
        </Text>
        <Text style={[styles.total, { color: colors.textSecondary }]}>
          {' '}/ ¥{(overview.total_budget ?? 0).toLocaleString()}
        </Text>
        <Text style={[styles.pctText, { color: statusColor }]}>
          {Math.round((overview.total_usage_rate ?? 0) * 100)}%
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.bar, { width: `${pct}%`, backgroundColor: statusColor }]} />
      </View>

      {warningBudgets.length > 0 && (
        <View style={styles.warnings}>
          {warningBudgets.slice(0, 3).map((b) => (
            <View key={b.id} style={styles.warningRow}>
              <FontAwesome
                name="exclamation-triangle"
                size={11}
                color={STATUS_COLORS[b.status]}
                style={{ marginRight: 6 }}
              />
              <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}>
                {b.account_name}
              </Text>
              <Text style={{ fontSize: 12, color: STATUS_COLORS[b.status], fontWeight: '600' }}>
                {Math.round(b.usage_rate * 100)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
  amounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  used: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  total: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  pctText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 3,
  },
  warnings: {
    marginTop: 10,
    gap: 6,
    backgroundColor: 'transparent',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
});
