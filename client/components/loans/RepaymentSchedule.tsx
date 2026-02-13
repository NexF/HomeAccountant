import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { RepaymentScheduleItem } from '@/services/loanService';

type Props = {
  schedule: RepaymentScheduleItem[];
};

export default function RepaymentSchedule({ schedule }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  if (schedule.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>暂无还款计划</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.text }]}>还款计划表</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={[styles.row, styles.headerRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.cell, styles.cellPeriod, styles.headerText, { color: colors.textSecondary }]}>期数</Text>
            <Text style={[styles.cell, styles.cellDate, styles.headerText, { color: colors.textSecondary }]}>还款日期</Text>
            <Text style={[styles.cell, styles.cellAmount, styles.headerText, { color: colors.textSecondary }]}>月供</Text>
            <Text style={[styles.cell, styles.cellAmount, styles.headerText, { color: colors.textSecondary }]}>本金</Text>
            <Text style={[styles.cell, styles.cellAmount, styles.headerText, { color: colors.textSecondary }]}>利息</Text>
            <Text style={[styles.cell, styles.cellAmount, styles.headerText, { color: colors.textSecondary }]}>剩余本金</Text>
            <Text style={[styles.cell, styles.cellStatus, styles.headerText, { color: colors.textSecondary }]}>状态</Text>
          </View>

          {/* Body */}
          {schedule.map((item) => (
            <View
              key={item.period}
              style={[
                styles.row,
                { borderBottomColor: colors.border },
                item.is_paid && { backgroundColor: Colors.primary + '08' },
              ]}
            >
              <Text style={[styles.cell, styles.cellPeriod, { color: colors.text }]}>{item.period}</Text>
              <Text style={[styles.cell, styles.cellDate, { color: colors.text }]}>{item.payment_date}</Text>
              <Text style={[styles.cell, styles.cellAmount, { color: colors.text }]}>¥{item.payment.toFixed(2)}</Text>
              <Text style={[styles.cell, styles.cellAmount, { color: Colors.primary }]}>¥{item.principal.toFixed(2)}</Text>
              <Text style={[styles.cell, styles.cellAmount, { color: Colors.asset }]}>¥{item.interest.toFixed(2)}</Text>
              <Text style={[styles.cell, styles.cellAmount, { color: colors.text }]}>¥{item.remaining.toFixed(2)}</Text>
              <View style={[styles.cell, styles.cellStatus]}>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: item.is_paid ? Colors.liability + '18' : colors.textSecondary + '18',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: item.is_paid ? Colors.liability : colors.textSecondary },
                    ]}
                  >
                    {item.is_paid ? '已还' : '待还'}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 8,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerRow: {
    paddingVertical: 8,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cell: {
    fontSize: 13,
  },
  cellPeriod: {
    width: 40,
    textAlign: 'center',
  },
  cellDate: {
    width: 100,
  },
  cellAmount: {
    width: 90,
    textAlign: 'right',
  },
  cellStatus: {
    width: 60,
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
