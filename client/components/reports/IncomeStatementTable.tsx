import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { IncomeStatementResponse, AccountBalanceItem } from '@/services/reportService';

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-¥${formatted}` : `¥${formatted}`;
}

type Props = {
  data: IncomeStatementResponse;
};

function AccountRow({ item, colors }: { item: AccountBalanceItem; colors: any }) {
  const balanceColor =
    item.account_type === 'income'
      ? Colors.asset
      : item.account_type === 'expense'
      ? Colors.liability
      : colors.text;

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.nameCell}>
        <Text style={[styles.code, { color: colors.textSecondary }]}>{item.account_code}</Text>
        <Text style={[styles.name, { color: colors.text }]}>{item.account_name}</Text>
      </View>
      <Text style={[styles.amount, { color: balanceColor }]}>{formatMoney(item.balance)}</Text>
    </View>
  );
}

/** 收入/费用占比条 */
function PercentBar({ items, total, type, colors }: {
  items: AccountBalanceItem[];
  total: number;
  type: 'income' | 'expense';
  colors: any;
}) {
  if (total === 0 || items.length === 0) return null;

  const barColor = type === 'income' ? Colors.asset : Colors.liability;
  const sorted = [...items].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return (
    <View style={styles.percentSection}>
      {sorted.map((item) => {
        const pct = total !== 0 ? (Math.abs(item.balance) / Math.abs(total)) * 100 : 0;
        if (pct < 0.5) return null;
        return (
          <View key={item.account_id} style={styles.percentRow}>
            <Text style={[styles.percentName, { color: colors.text }]} numberOfLines={1}>
              {item.account_name}
            </Text>
            <View style={styles.barContainer}>
              <View
                style={[styles.bar, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]}
              />
            </View>
            <Text style={[styles.percentText, { color: colors.textSecondary }]}>
              {pct.toFixed(1)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function IncomeStatementTable({ data }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <View>
      {/* 摘要卡片 */}
      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总收入</Text>
            <Text style={[styles.summaryValue, { color: Colors.asset }]}>
              {formatMoney(data.total_income)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总费用</Text>
            <Text style={[styles.summaryValue, { color: Colors.liability }]}>
              {formatMoney(data.total_expense)}
            </Text>
          </View>
        </View>
        <View style={[styles.netIncomeRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.netIncomeLabel, { color: colors.text }]}>本期损益</Text>
          <Text
            style={[
              styles.netIncomeValue,
              { color: data.net_income >= 0 ? Colors.asset : Colors.liability },
            ]}
          >
            {formatMoney(data.net_income)}
          </Text>
        </View>
      </View>

      {/* 收入明细 */}
      {data.incomes.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>收入明细</Text>
          {data.incomes.map((a) => (
            <AccountRow key={a.account_id} item={a} colors={colors} />
          ))}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>收入合计</Text>
            <Text style={[styles.totalAmount, { color: Colors.asset }]}>
              {formatMoney(data.total_income)}
            </Text>
          </View>
          <PercentBar items={data.incomes} total={data.total_income} type="income" colors={colors} />
        </View>
      )}

      {/* 费用明细 */}
      {data.expenses.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>费用明细</Text>
          {data.expenses.map((a) => (
            <AccountRow key={a.account_id} item={a} colors={colors} />
          ))}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>费用合计</Text>
            <Text style={[styles.totalAmount, { color: Colors.liability }]}>
              {formatMoney(data.total_expense)}
            </Text>
          </View>
          <PercentBar items={data.expenses} total={data.total_expense} type="expense" colors={colors} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  netIncomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  netIncomeLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  netIncomeValue: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameCell: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  code: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
  },
  name: {
    fontSize: 14,
  },
  amount: {
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalRow: {
    borderBottomWidth: 0,
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  percentSection: {
    marginTop: 12,
    gap: 6,
  },
  percentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  percentName: {
    fontSize: 12,
    width: 70,
  },
  barContainer: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
    opacity: 0.7,
  },
  percentText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    width: 46,
    textAlign: 'right',
  },
});
