import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { loanService, type LoanSummary, type LoanResponse } from '@/services/loanService';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type Props = {
  bookId: string | undefined;
  onPress?: () => void;
};

export default function LoanOverview({ bookId, onPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [nextLoan, setNextLoan] = useState<LoanResponse | null>(null);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      try {
        const [sumRes, loansRes] = await Promise.all([
          loanService.getSummary(bookId),
          loanService.listLoans(bookId, 'active'),
        ]);
        setSummary(sumRes.data);
        // 找最近一笔待还款贷款（按 start_date 排序，取最早的）
        const active = loansRes.data;
        if (active.length > 0) {
          // 计算最近还款日：start_date + repaid_months 个月
          const withNext = active.map((l) => {
            const start = new Date(l.start_date);
            start.setMonth(start.getMonth() + l.repaid_months);
            return { loan: l, nextDate: start };
          });
          withNext.sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());
          setNextLoan(withNext[0].loan);
        }
      } catch {
        // ignore
      }
    })();
  }, [bookId]);

  if (!summary || summary.loan_count === 0) {
    return null;
  }

  const repaidPct = summary.total_principal > 0
    ? Math.round(summary.total_paid_principal / summary.total_principal * 100)
    : 0;

  const monthlyTotal = nextLoan ? nextLoan.monthly_payment : 0;

  return (
    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={onPress}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <FontAwesome name="bank" size={14} color={Colors.liability} style={{ marginRight: 6 }} />
          <Text style={[styles.title, { color: colors.text }]}>贷款概览</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>剩余本金</Text>
          <Text style={[styles.statValue, { color: Colors.liability }]}>
            ¥{summary.total_remaining.toLocaleString()}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>本月应还</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            ¥{monthlyTotal.toFixed(2)}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>还款中</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {summary.active_count} 笔
          </Text>
        </View>
      </View>

      {/* 还款进度 */}
      <View style={styles.progressRow}>
        <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
          已还本金 {repaidPct}%
        </Text>
        <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
          已付利息 ¥{summary.total_interest_paid.toLocaleString()}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.bar, { width: `${Math.min(repaidPct, 100)}%`, backgroundColor: repaidPct >= 100 ? Colors.asset : Colors.primary }]} />
      </View>
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
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  stat: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  statLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  progressLabel: {
    fontSize: 11,
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
});
