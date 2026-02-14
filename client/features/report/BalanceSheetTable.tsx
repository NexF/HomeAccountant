import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { BalanceSheetResponse, AccountBalanceItem } from '@/services/reportService';

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-¥${formatted}` : `¥${formatted}`;
}

type Props = {
  data: BalanceSheetResponse;
};

function AccountRow({ item, colors }: { item: AccountBalanceItem; colors: any }) {
  const balanceColor =
    item.balance > 0
      ? item.account_type === 'liability'
        ? Colors.liability
        : Colors.asset
      : item.balance < 0
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

function TotalRow({ label, amount, color, colors }: { label: string; amount: number; color?: string; colors: any }) {
  return (
    <View style={[styles.row, styles.totalRow]}>
      <Text style={[styles.totalLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.totalAmount, { color: color ?? colors.text }]}>{formatMoney(amount)}</Text>
    </View>
  );
}

function SectionCard({ title, items, totalLabel, totalAmount, totalColor, colors }: {
  title: string;
  items: AccountBalanceItem[];
  totalLabel: string;
  totalAmount: number;
  totalColor?: string;
  colors: any;
}) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {items.map((a) => (
        <AccountRow key={a.account_id} item={a} colors={colors} />
      ))}
      <TotalRow label={totalLabel} amount={totalAmount} color={totalColor} colors={colors} />
    </View>
  );
}

export default function BalanceSheetTable({ data }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();

  // T 型布局：桌面端左右分栏，移动端上下堆叠
  const leftColumn = (
    <View style={[styles.column, isDesktop && styles.columnHalf]}>
      {data.assets.length > 0 && (
        <SectionCard
          title="资产"
          items={data.assets}
          totalLabel="资产合计"
          totalAmount={data.total_asset}
          totalColor={Colors.asset}
          colors={colors}
        />
      )}
    </View>
  );

  const rightColumn = (
    <View style={[styles.column, isDesktop && styles.columnHalf]}>
      {data.liabilities.length > 0 && (
        <SectionCard
          title="负债"
          items={data.liabilities}
          totalLabel="负债合计"
          totalAmount={data.total_liability}
          totalColor={Colors.liability}
          colors={colors}
        />
      )}
      <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>净资产</Text>
        {data.equities.map((a) => (
          <AccountRow key={a.account_id} item={a} colors={colors} />
        ))}
        {data.net_income !== 0 && (
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={styles.nameCell}>
              <Text style={[styles.code, { color: colors.textSecondary }]}>--</Text>
              <Text style={[styles.name, { color: colors.text }]}>本期损益</Text>
            </View>
            <Text
              style={[
                styles.amount,
                { color: data.net_income >= 0 ? Colors.asset : Colors.liability },
              ]}
            >
              {formatMoney(data.net_income)}
            </Text>
          </View>
        )}
        <TotalRow
          label="净资产合计"
          amount={data.adjusted_equity}
          color={Colors.primary}
          colors={colors}
        />
      </View>
    </View>
  );

  return (
    <View>
      {/* 摘要卡片 */}
      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总资产</Text>
            <Text style={[styles.summaryValue, { color: Colors.asset }]}>
              {formatMoney(data.total_asset)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总负债</Text>
            <Text style={[styles.summaryValue, { color: Colors.liability }]}>
              {formatMoney(data.total_liability)}
            </Text>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>净资产</Text>
            <Text style={[styles.summaryValue, { color: Colors.primary }]}>
              {formatMoney(data.adjusted_equity)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>本期损益</Text>
            <Text
              style={[
                styles.summaryValue,
                { color: data.net_income >= 0 ? Colors.asset : Colors.liability },
              ]}
            >
              {formatMoney(data.net_income)}
            </Text>
          </View>
        </View>
        {!data.is_balanced && (
          <View style={styles.warningBadge}>
            <Text style={styles.warningText}>资产负债不平衡</Text>
          </View>
        )}
      </View>

      {/* T 型布局主体 */}
      <View style={[styles.tLayout, isDesktop && styles.tLayoutRow]}>
        {leftColumn}
        {rightColumn}
      </View>

      {/* 等式校验行 */}
      <View style={[styles.equationCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.equationText, { color: colors.text }]}>
          资产{' '}
          <Text style={{ color: Colors.asset }}>{formatMoney(data.total_asset)}</Text>
          {' = 负债 '}
          <Text style={{ color: Colors.liability }}>{formatMoney(data.total_liability)}</Text>
          {' + 净资产 '}
          <Text style={{ color: Colors.primary }}>{formatMoney(data.adjusted_equity)}</Text>
        </Text>
        <View style={[styles.checkBadge, { backgroundColor: data.is_balanced ? '#D1FAE5' : '#FEF3C7' }]}>
          <Text style={{ color: data.is_balanced ? '#059669' : '#D97706', fontSize: 12, fontWeight: '600' }}>
            {data.is_balanced ? '✓ 平衡' : '✗ 不平衡'}
          </Text>
        </View>
      </View>
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
  warningBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  warningText: {
    color: '#D97706',
    fontSize: 12,
    fontWeight: '500',
  },
  tLayout: {
    gap: 12,
  },
  tLayoutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flex: 1,
  },
  columnHalf: {
    flex: 1,
  },
  sectionCard: {
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
  equationCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  equationText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  checkBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
});
