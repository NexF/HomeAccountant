import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  reportService,
  type DashboardResponse,
  type NetWorthTrendPoint,
  type BreakdownItem,
} from '@/services/reportService';
import { syncService } from '@/services/syncService';
import NetWorthBadge from '@/components/reports/NetWorthBadge';
import LineChart from '@/components/charts/LineChart';
import PieChart from '@/components/charts/PieChart';

import BudgetOverview from '@/components/budget/BudgetOverview';
import LoanOverview from '@/components/loans/LoanOverview';
import EntryCard from '@/components/entry/EntryCard';
import { useProfileNavStore } from '@/stores/profileNavStore';

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-¥${s}` : `¥${s}`;
}


export default function DashboardScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 768;
  const chartWidth = isDesktop
    ? 380 - 32 - 32
    : Math.min(screenWidth - 64, 500);
  const navigateToProfile = useProfileNavStore((s) => s.navigateTo);

  const goToProfilePane = (pane: string, mobileRoute: string) => {
    if (isDesktop) {
      navigateToProfile(pane);
      router.push('/(tabs)/profile' as any);
    } else {
      router.push(mobileRoute as any);
    }
  };

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [trend, setTrend] = useState<NetWorthTrendPoint[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<BreakdownItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const fetchData = useCallback(async () => {
    if (!currentBook) return;
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const monthStart = new Date(y, m, 1).toISOString().slice(0, 10);
      const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);

      const [dashRes, trendRes, expRes, pendingRes] = await Promise.all([
        reportService.getDashboard(currentBook.id),
        reportService.getNetWorthTrend(currentBook.id, 6),
        reportService.getExpenseBreakdown(currentBook.id, monthStart, monthEnd),
        syncService.getPendingCount(currentBook.id),
      ]);
      setDashboard(dashRes.data);
      setTrend(trendRes.data);
      setExpenseBreakdown(expRes.data);
      setPendingCount(pendingRes.data.count);
    } catch {
      // ignore
    }
  }, [currentBook]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData().finally(() => setLoading(false));
    }, [fetchData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  const d = dashboard;

  // Shared components
  const netWorthSection = (
    <NetWorthBadge
      netAsset={d?.net_asset ?? 0}
      change={d?.net_asset_change ?? 0}
      totalAsset={d?.total_asset ?? 0}
      totalLiability={d?.total_liability ?? 0}
      onPress={() => router.push('/reports/balance-sheet' as any)}
    />
  );

  const incomeExpenseCards = (
    <View style={styles.row}>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.cardHeader}>
          <FontAwesome name="arrow-up" size={12} color={Colors.asset} />
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>本月收入</Text>
        </View>
        <Text style={[styles.cardAmount, { color: Colors.asset }]}>
          {fmt(d?.month_income ?? 0)}
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.cardHeader}>
          <FontAwesome name="arrow-down" size={12} color={Colors.liability} />
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>本月费用</Text>
        </View>
        <Text style={[styles.cardAmount, { color: Colors.liability }]}>
          {fmt(d?.month_expense ?? 0)}
        </Text>
      </View>
    </View>
  );

  const surplusCard = (
    <View style={[styles.surplusCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.surplusLabel, { color: colors.textSecondary }]}>本月结余</Text>
      <Text
        style={[
          styles.surplusAmount,
          { color: (d?.month_net_income ?? 0) >= 0 ? Colors.asset : Colors.liability },
        ]}
      >
        {fmt(d?.month_net_income ?? 0)}
      </Text>
    </View>
  );

  const trendChart = trend.length >= 2 ? (
    <Pressable onPress={() => router.push('/reports/trends' as any)}>
      <LineChart
        data={trend.map((p) => ({ label: p.label.slice(5), value: p.net_asset }))}
        width={chartWidth}
        height={180}
        color={Colors.primary}
        title="净资产趋势"
      />
    </Pressable>
  ) : null;

  const pieChart = expenseBreakdown.length > 0 ? (
    <PieChart
      data={expenseBreakdown.map((e) => ({
        label: e.account_name,
        value: e.amount,
        percentage: e.percentage,
      }))}
      size={140}
      title="本月费用分类"
    />
  ) : null;

  const pendingSection = pendingCount > 0 ? (
    <Pressable
      style={[styles.pendingCard, { backgroundColor: colors.card }]}
      onPress={() => router.push('/sync/reconcile' as any)}
    >
      <View style={styles.pendingLeft}>
        <FontAwesome name="exchange" size={16} color={Colors.primary} />
        <Text style={[styles.pendingText, { color: colors.text }]}>待处理对账</Text>
      </View>
      <View style={styles.pendingRight}>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
      </View>
    </Pressable>
  ) : null;

  const budgetSection = (
    <BudgetOverview
      bookId={currentBook?.id}
      onPress={() => goToProfilePane('budget', '/settings/budget')}
    />
  );

  const loanSection = (
    <LoanOverview
      bookId={currentBook?.id}
      onPress={() => goToProfilePane('loans', '/loans')}
    />
  );

  const recentEntriesList = (d?.recent_entries ?? []).length === 0 ? (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        暂无记录，点击 + 开始记账
      </Text>
    </View>
  ) : (
    d!.recent_entries.map((entry) => (
      <EntryCard key={entry.id} entry={entry} />
    ))
  );

  const fab = (
    <Pressable
      style={[styles.fab, { backgroundColor: Colors.primary }]}
      onPress={() => router.push('/entry/new' as any)}
    >
      <FontAwesome name="plus" size={22} color="#FFFFFF" />
    </Pressable>
  );

  // Desktop: left-right split layout
  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        {/* Left panel: overview (fixed 380px) */}
        <ScrollView
          style={[styles.desktopLeft, { borderRightColor: colors.border }]}
          contentContainerStyle={styles.desktopLeftContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {netWorthSection}
          {incomeExpenseCards}
          {surplusCard}
          {trendChart}
          {pieChart}
          {pendingSection}
          {budgetSection}
          {loanSection}
        </ScrollView>

        {/* Right panel: recent entries (flex: 1) */}
        <View style={[styles.desktopRight, { backgroundColor: colors.background }]}>
          <View style={styles.desktopRightHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>近期分录</Text>
            <Pressable onPress={() => router.push('/(tabs)/ledger' as any)}>
              <Text style={[styles.sectionLink, { color: Colors.primary }]}>查看全部</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.desktopRightScroll} contentContainerStyle={styles.desktopRightScrollContent}>
            {recentEntriesList}
          </ScrollView>
          {fab}
        </View>
      </View>
    );
  }

  // Mobile layout (no recent entries — use Ledger tab instead)
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
    >
      {netWorthSection}
      {incomeExpenseCards}
      {surplusCard}
      {trendChart}
      {pieChart}
      {pendingSection}
      {budgetSection}
      {loanSection}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  cardLabel: {
    fontSize: 13,
  },
  cardAmount: {
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  surplusCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  surplusLabel: {
    fontSize: 14,
  },
  surplusAmount: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // Desktop left-right split
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopLeft: {
    width: 380,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
  },
  desktopLeftContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  desktopRight: {
    flex: 1,
  },
  desktopRightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  desktopRightScroll: {
    flex: 1,
  },
  desktopRightScrollContent: {
    paddingBottom: 80,
  },
  // Pending
  pendingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  pendingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'transparent',
  },
  pendingText: {
    fontSize: 15,
    fontWeight: '500',
  },
  pendingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  pendingBadge: {
    backgroundColor: Colors.liability,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pendingBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Entries section
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sectionLink: {
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
