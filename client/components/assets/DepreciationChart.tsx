import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { DepreciationRecord } from '@/services/assetService';

type Props = {
  records: DepreciationRecord[];
  originalCost: number;
};

export default function DepreciationChart({ records, originalCost }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  if (records.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.card }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          暂无折旧记录
        </Text>
      </View>
    );
  }

  const maxValue = originalCost;

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.text }]}>折旧历史</Text>
      {records.map((record, index) => {
        const depPct = maxValue > 0 ? (record.accumulated / maxValue) * 100 : 0;
        const netPct = 100 - depPct;

        return (
          <View key={record.entry_id ?? index} style={styles.row}>
            <Text style={[styles.period, { color: colors.textSecondary }]} numberOfLines={1}>
              {record.period}
            </Text>
            <View style={styles.barContainer}>
              <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      backgroundColor: Colors.primary + '40',
                      width: `${Math.min(depPct, 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={[styles.amount, { color: colors.text }]}>
              ¥{record.amount.toFixed(2)}
            </Text>
          </View>
        );
      })}

      {/* 汇总 */}
      <View style={[styles.summaryRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
          累计折旧
        </Text>
        <Text style={[styles.summaryValue, { color: Colors.asset }]}>
          ¥{records[records.length - 1]?.accumulated.toFixed(2) ?? '0.00'}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
          当前净值
        </Text>
        <Text style={[styles.summaryValue, { color: Colors.primary }]}>
          ¥{records[records.length - 1]?.net_value.toFixed(2) ?? originalCost.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  period: {
    width: 80,
    fontSize: 12,
  },
  barContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  amount: {
    width: 72,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  summaryLabel: {
    fontSize: 13,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    borderRadius: 12,
    padding: 32,
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
