import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
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
  type BalanceSheetResponse,
  type IncomeStatementResponse,
  type BreakdownItem,
  type NetWorthTrendPoint,
} from '@/services/reportService';
import BalanceSheetTable from '@/components/reports/BalanceSheetTable';
import IncomeStatementTable from '@/components/reports/IncomeStatementTable';
import DatePicker from '@/components/reports/DatePicker';
import PieChart from '@/components/charts/PieChart';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';

type Tab = 'balance' | 'income' | 'trends';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

function getDefaultTrendRange(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);
  return { start, end };
}

function monthsBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

export default function ReportsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 64, 500);

  const [tab, setTab] = useState<Tab>('balance');

  // 资产负债表状态
  const [bsDate, setBsDate] = useState(today());
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null);

  // 损益表状态
  const defaultRange = getMonthRange();
  const [isStartDate, setIsStartDate] = useState(defaultRange.start);
  const [isEndDate, setIsEndDate] = useState(defaultRange.end);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementResponse | null>(null);
  const [expenseBreakdown, setExpenseBreakdown] = useState<BreakdownItem[]>([]);

  // 趋势分析状态
  const defaultTrendRange = getDefaultTrendRange();
  const [trendStartDate, setTrendStartDate] = useState(defaultTrendRange.start);
  const [trendEndDate, setTrendEndDate] = useState(defaultTrendRange.end);
  const [trend, setTrend] = useState<NetWorthTrendPoint[]>([]);
  const [trendExpenseBreakdown, setTrendExpenseBreakdown] = useState<BreakdownItem[]>([]);
  const [assetAllocation, setAssetAllocation] = useState<BreakdownItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentBook) return;
    setLoading(true);
    try {
      if (tab === 'balance') {
        const { data } = await reportService.getBalanceSheet(currentBook.id, bsDate);
        setBalanceSheet(data);
      } else if (tab === 'income') {
        const [isRes, expRes] = await Promise.all([
          reportService.getIncomeStatement(currentBook.id, isStartDate, isEndDate),
          reportService.getExpenseBreakdown(currentBook.id, isStartDate, isEndDate),
        ]);
        setIncomeStatement(isRes.data);
        setExpenseBreakdown(expRes.data);
      } else {
        const months = monthsBetween(trendStartDate, trendEndDate);
        const [trendRes, expRes, assetRes] = await Promise.all([
          reportService.getNetWorthTrend(currentBook.id, months),
          reportService.getExpenseBreakdown(currentBook.id, trendStartDate, trendEndDate),
          reportService.getAssetAllocation(currentBook.id),
        ]);
        setTrend(trendRes.data);
        setTrendExpenseBreakdown(expRes.data);
        setAssetAllocation(assetRes.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentBook, tab, bsDate, isStartDate, isEndDate, trendStartDate, trendEndDate]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const barData = trend.map((p) => ({
    label: p.label.slice(5),
    values: [
      { value: p.total_asset, color: Colors.asset, label: '资产' },
      { value: p.total_liability, color: Colors.liability, label: '负债' },
    ],
  }));

  const tabs: { key: Tab; label: string; icon: React.ComponentProps<typeof FontAwesome>['name'] }[] = [
    { key: 'balance', label: '资产负债表', icon: 'balance-scale' },
    { key: 'income', label: '损益表', icon: 'line-chart' },
    { key: 'trends', label: '趋势分析', icon: 'area-chart' },
  ];

  const isEmpty =
    (tab === 'balance' &&
      balanceSheet &&
      balanceSheet.assets.length === 0 &&
      balanceSheet.liabilities.length === 0 &&
      balanceSheet.equities.length === 0) ||
    (tab === 'income' &&
      incomeStatement &&
      incomeStatement.incomes.length === 0 &&
      incomeStatement.expenses.length === 0) ||
    (tab === 'trends' &&
      trend.length === 0 &&
      trendExpenseBreakdown.length === 0 &&
      assetAllocation.length === 0);

  return (
    <View style={styles.container}>
      {/* Tab 栏 */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            style={[
              styles.tabItem,
              tab === t.key && { backgroundColor: Colors.primary },
            ]}
            onPress={() => setTab(t.key)}
          >
            <FontAwesome
              name={t.icon}
              size={13}
              color={tab === t.key ? '#FFFFFF' : colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.tabText,
                { color: tab === t.key ? '#FFFFFF' : colors.textSecondary },
                tab === t.key && styles.tabTextActive,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}

        <Pressable
          style={[styles.expandBtn, { borderColor: colors.border }]}
          onPress={() =>
            router.push(
              tab === 'balance'
                ? '/reports/balance-sheet'
                : tab === 'income'
                  ? '/reports/income-statement'
                  : '/reports/trends' as any,
            )
          }
        >
          <FontAwesome name="expand" size={14} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* 日期选择器 */}
      <View style={styles.dateBar}>
        {tab === 'balance' ? (
          <DatePicker mode="date" date={bsDate} onDateChange={setBsDate} />
        ) : tab === 'income' ? (
          <DatePicker
            mode="range"
            startDate={isStartDate}
            endDate={isEndDate}
            onRangeChange={(s, e) => {
              setIsStartDate(s);
              setIsEndDate(e);
            }}
          />
        ) : (
          <DatePicker
            mode="range"
            startDate={trendStartDate}
            endDate={trendEndDate}
            onRangeChange={(s, e) => {
              setTrendStartDate(s);
              setTrendEndDate(e);
            }}
          />
        )}
      </View>

      {/* 内容 */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : isEmpty ? (
        <View style={styles.empty}>
          <FontAwesome name="bar-chart" size={60} color={colors.textSecondary} style={{ opacity: 0.3 }} />
          <Text style={[styles.emptyText, { color: colors.text }]}>暂无报表数据</Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            记几笔账后即可生成报表
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            tab === 'trends' && styles.scrollContentCentered,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {tab === 'balance' && balanceSheet && (
            <>
              <BalanceSheetTable data={balanceSheet} />
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                截至 {balanceSheet.as_of_date}
              </Text>
            </>
          )}
          {tab === 'income' && incomeStatement && (
            <>
              <IncomeStatementTable data={incomeStatement} />
              {expenseBreakdown.length > 0 && (
                <PieChart
                  data={expenseBreakdown.map((e) => ({
                    label: e.account_name,
                    value: e.amount,
                    percentage: e.percentage,
                  }))}
                  size={160}
                  title="费用分类占比"
                />
              )}
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                {incomeStatement.start_date} ~ {incomeStatement.end_date}
              </Text>
            </>
          )}
          {tab === 'trends' && (
            <>
              <LineChart
                data={trend.map((p) => ({ label: p.label.slice(5), value: p.net_asset }))}
                width={chartWidth}
                height={220}
                color={Colors.primary}
                title="净资产趋势"
              />
              <BarChart
                data={barData}
                width={chartWidth}
                height={220}
                title="资产 vs 负债"
              />
              {trendExpenseBreakdown.length > 0 && (
                <PieChart
                  data={trendExpenseBreakdown.map((e) => ({
                    label: e.account_name,
                    value: e.amount,
                    percentage: e.percentage,
                  }))}
                  size={160}
                  title="费用分类"
                />
              )}
              {assetAllocation.length > 0 && (
                <PieChart
                  data={assetAllocation.map((a) => ({
                    label: a.account_name,
                    value: a.amount,
                    percentage: a.percentage,
                  }))}
                  size={160}
                  title="资产配置"
                />
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  tabText: {
    fontSize: 14,
  },
  tabTextActive: {
    fontWeight: '600',
  },
  expandBtn: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
    gap: 16,
  },
  scrollContentCentered: {
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyHint: {
    fontSize: 13,
  },
});
