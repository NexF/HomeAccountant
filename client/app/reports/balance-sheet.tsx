import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { reportService, type BalanceSheetResponse } from '@/services/reportService';
import BalanceSheetTable from '@/features/report/BalanceSheetTable';
import DatePicker from '@/features/report/DatePicker';

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function BalanceSheetScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<BalanceSheetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentBook) return;
    setLoading(true);
    try {
      const { data: res } = await reportService.getBalanceSheet(currentBook.id, date);
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentBook, date]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const isEmpty =
    data &&
    data.assets.length === 0 &&
    data.liabilities.length === 0 &&
    data.equities.length === 0;

  return (
    <View style={styles.container}>
      {/* 顶栏 */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="chevron-left" size={16} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>资产负债表</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 日期选择器 */}
      <View style={styles.dateBar}>
        <DatePicker mode="date" date={date} onDateChange={setDate} />
      </View>

      {/* 内容 */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={[styles.emptyText, { color: colors.text }]}>暂无数据</Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            记几笔账后即可生成资产负债表
          </Text>
        </View>
      ) : data ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          <BalanceSheetTable data={data} onRefresh={fetchData} editable={date === today()} />
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            截至 {data.as_of_date}
          </Text>
        </ScrollView>
      ) : null}
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  dateBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
  },
});
