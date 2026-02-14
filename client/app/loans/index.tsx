import React, { useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useLoanStore } from '@/stores/loanStore';
import type { LoanResponse } from '@/services/loanService';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const STATUS_TABS = [
  { key: null, label: '全部' },
  { key: 'active', label: '还款中' },
  { key: 'paid_off', label: '已结清' },
] as const;

const METHOD_LABEL: Record<string, string> = {
  equal_installment: '等额本息',
  equal_principal: '等额本金',
};

function LoanCard({ loan, onPress }: { loan: LoanResponse; onPress: (l: LoanResponse) => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isPaidOff = loan.status === 'paid_off';
  const progress = loan.principal > 0
    ? Math.round(((loan.principal - loan.remaining_principal) / loan.principal) * 100)
    : 100;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => onPress(loan)}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.iconCircle, { backgroundColor: Colors.liability + '15' }]}>
          <FontAwesome name="credit-card" size={16} color={Colors.liability} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardName} numberOfLines={1}>{loan.name}</Text>
          <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
            {loan.account_name} · {METHOD_LABEL[loan.repayment_method]}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: isPaidOff ? colors.textSecondary + '18' : Colors.liability + '15' },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: isPaidOff ? colors.textSecondary : Colors.liability },
            ]}
          >
            {isPaidOff ? '已结清' : '还款中'}
          </Text>
        </View>
      </View>

      {/* Progress */}
      {!isPaidOff && (
        <View style={styles.progressSection}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              还款进度 ({loan.repaid_months}/{loan.total_months}期)
            </Text>
            <Text style={[styles.progressValue, { color: colors.text }]}>{progress}%</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressBar,
                {
                  backgroundColor: progress >= 100 ? Colors.liability : Colors.primary,
                  width: `${Math.min(progress, 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Stats */}
      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>贷款本金</Text>
          <Text style={styles.statValue}>¥{loan.principal.toLocaleString()}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>剩余本金</Text>
          <Text style={[styles.statValue, { color: Colors.primary }]}>
            ¥{loan.remaining_principal.toLocaleString()}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>月供</Text>
          <Text style={[styles.statValue, { color: Colors.asset }]}>
            ¥{loan.monthly_payment.toFixed(2)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function LoanListScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { loans, summary, isLoading, filterStatus, fetchLoans, fetchSummary, setFilterStatus } =
    useLoanStore();
  const { isDesktop } = useBreakpoint();

  useFocusEffect(
    useCallback(() => {
      if (currentBook) {
        fetchLoans(currentBook.id);
        fetchSummary(currentBook.id);
      }
    }, [currentBook?.id, filterStatus])
  );

  const handleLoanPress = useCallback(
    (loan: LoanResponse) => {
      router.push(`/loans/${loan.id}` as any);
    },
    [router]
  );

  const handleStatusChange = useCallback(
    (status: string | null) => {
      setFilterStatus(status);
    },
    [setFilterStatus]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>贷款管理</Text>
        <Pressable
          style={[styles.addBtn, { backgroundColor: Colors.primary }]}
          onPress={() => router.push('/loans/new' as any)}
        >
          <FontAwesome name="plus" size={14} color="#FFF" />
        </Pressable>
      </View>

      {/* Summary */}
      {summary && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>贷款总额</Text>
              <Text style={styles.summaryValue}>¥{summary.total_principal.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>剩余本金</Text>
              <Text style={[styles.summaryValue, { color: Colors.primary }]}>
                ¥{summary.total_remaining.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>已付利息</Text>
              <Text style={[styles.summaryValue, { color: Colors.asset }]}>
                ¥{summary.total_interest_paid.toLocaleString()}
              </Text>
            </View>
          </View>
          <Text style={[styles.summaryCount, { color: colors.textSecondary }]}>
            共 {summary.loan_count} 笔贷款，{summary.active_count} 笔还款中
          </Text>
        </View>
      )}

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabContent}
      >
        {STATUS_TABS.map((tab) => {
          const active = filterStatus === tab.key;
          return (
            <Pressable
              key={tab.key ?? 'all'}
              style={[
                styles.tab,
                active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
              ]}
              onPress={() => handleStatusChange(tab.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? Colors.primary : colors.textSecondary },
                  active && { fontWeight: '600' },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Loan List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : loans.length === 0 ? (
        <View style={styles.center}>
          <FontAwesome name="credit-card" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>暂无贷款</Text>
          <Pressable
            style={[styles.emptyBtn, { borderColor: Colors.primary }]}
            onPress={() => router.push('/loans/new' as any)}
          >
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>新建贷款</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={isDesktop ? styles.listDesktop : undefined}
        >
          {loans.map((loan) => (
            <LoanCard key={loan.id} loan={loan} onPress={handleLoanPress} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 52,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  summaryCount: {
    fontSize: 12,
    marginTop: 8,
  },
  tabBar: {
    flexGrow: 0,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  tabContent: {
    gap: 8,
    paddingRight: 12,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  listDesktop: {
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
  emptyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 8,
  },
  // Card styles
  card: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
  },
  cardSub: {
    fontSize: 12,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  stats: {
    flexDirection: 'row',
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
  },
});
