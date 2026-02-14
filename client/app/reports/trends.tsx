import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  reportService,
  type NetWorthTrendPoint,
  type BreakdownItem,
} from '@/services/reportService';
import LineChart from '@/features/chart/LineChart';
import PieChart from '@/features/chart/PieChart';
import BarChart from '@/features/chart/BarChart';

function getMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

export default function TrendsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 64, 500);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trend, setTrend] = useState<NetWorthTrendPoint[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<BreakdownItem[]>([]);
  const [assetAllocation, setAssetAllocation] = useState<BreakdownItem[]>([]);

  const fetchData = useCallback(async () => {
    if (!currentBook) return;
    try {
      const { start, end } = getMonthRange();
      const [trendRes, expRes, assetRes] = await Promise.all([
        reportService.getNetWorthTrend(currentBook.id, 12),
        reportService.getExpenseBreakdown(currentBook.id, start, end),
        reportService.getAssetAllocation(currentBook.id),
      ]);
      setTrend(trendRes.data);
      setExpenseBreakdown(expRes.data);
      setAssetAllocation(assetRes.data);
    } catch {
      // ignore
    }
  }, [currentBook]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // 构造收入 vs 费用柱状图数据（从趋势数据中提取）
  const barData = trend.map((p) => ({
    label: p.label.slice(5), // MM
    values: [
      { value: p.total_asset, color: Colors.asset, label: '资产' },
      { value: p.total_liability, color: Colors.liability, label: '负债' },
    ],
  }));

  return (
    <View style={styles.container}>
      {/* 顶栏 */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="arrow-left" size={16} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>趋势分析</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {/* 净资产趋势折线图 */}
          <LineChart
            data={trend.map((p) => ({ label: p.label.slice(5), value: p.net_asset }))}
            width={chartWidth}
            height={220}
            color={Colors.primary}
            title="净资产趋势"
          />

          {/* 资产 vs 负债柱状图 */}
          <BarChart
            data={barData}
            width={chartWidth}
            height={220}
            title="资产 vs 负债"
          />

          {/* 费用分类饼图 */}
          <PieChart
            data={expenseBreakdown.map((e) => ({
              label: e.account_name,
              value: e.amount,
              percentage: e.percentage,
            }))}
            size={160}
            title="本月费用分类"
          />

          {/* 资产配置饼图 */}
          <PieChart
            data={assetAllocation.map((a) => ({
              label: a.account_name,
              value: a.amount,
              percentage: a.percentage,
            }))}
            size={160}
            title="资产配置"
          />
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
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
    paddingBottom: 40,
    alignItems: 'center',
    gap: 16,
  },
});
