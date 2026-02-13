import React, { useEffect, useCallback, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useEntryStore } from '@/stores/entryStore';
import EntryCard from '@/components/entry/EntryCard';
import type { EntryResponse } from '@/services/entryService';
import { entryService } from '@/services/entryService';

const FILTER_TABS = [
  { key: null, label: '全部' },
  { key: 'expense', label: '费用' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
  { key: 'asset_purchase', label: '购置资产' },
  { key: 'asset_dispose', label: '处置资产' },
  { key: 'depreciation', label: '折旧' },
  { key: 'repay', label: '还款' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  expense: '费用',
  income: '收入',
  asset_purchase: '购置资产',
  asset_dispose: '处置资产',
  borrow: '借入',
  repay: '还款',
  transfer: '转账',
  manual: '手工',
  depreciation: '折旧',
  reconciliation: '对账调节',
};

/** 按日期分组 */
function groupByDate(entries: EntryResponse[]): { date: string; items: EntryResponse[] }[] {
  const map = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const d = e.entry_date;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function EntryDetailPane({
  entryId,
  colors,
}: {
  entryId: string;
  colors: typeof Colors.light;
}) {
  const [entry, setEntry] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    entryService
      .getEntry(entryId)
      .then(({ data }) => setEntry(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entryId]);

  if (loading) {
    return (
      <View style={styles.detailCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.detailCenter}>
        <Text style={{ color: colors.textSecondary }}>无法加载分录详情</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>
        {TYPE_LABELS[entry.entry_type] || entry.entry_type}
      </Text>
      <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>日期</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>{entry.entry_date}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>摘要</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>
            {entry.description || '-'}
          </Text>
        </View>
        {entry.note ? (
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>备注</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{entry.note}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>来源</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>{entry.source}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>借贷平衡</Text>
          <Text
            style={[
              styles.detailValue,
              { color: entry.is_balanced ? Colors.liability : Colors.asset },
            ]}
          >
            {entry.is_balanced ? '是' : '否'}
          </Text>
        </View>
      </View>

      {/* Lines */}
      {entry.lines && entry.lines.length > 0 && (
        <>
          <Text style={[styles.detailSubtitle, { color: colors.text }]}>借贷明细</Text>
          <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
            <View style={[styles.lineHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.lineHeaderCell, styles.lineAccount, { color: colors.textSecondary }]}>科目</Text>
              <Text style={[styles.lineHeaderCell, styles.lineAmount, { color: colors.textSecondary }]}>借方</Text>
              <Text style={[styles.lineHeaderCell, styles.lineAmount, { color: colors.textSecondary }]}>贷方</Text>
            </View>
            {entry.lines.map((line: any) => (
              <View key={line.id} style={[styles.lineRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.lineCell, styles.lineAccount, { color: colors.text }]} numberOfLines={1}>
                  {line.account_name || line.account_id}
                </Text>
                <Text style={[styles.lineCell, styles.lineAmount, { fontVariant: ['tabular-nums'] }]}>
                  {Number(line.debit_amount) > 0 ? Number(line.debit_amount).toFixed(2) : '-'}
                </Text>
                <Text style={[styles.lineCell, styles.lineAmount, { fontVariant: ['tabular-nums'] }]}>
                  {Number(line.credit_amount) > 0 ? Number(line.credit_amount).toFixed(2) : '-'}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

export default function LedgerScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const currentBook = useBookStore((s) => s.currentBook);
  const fetchBooks = useBookStore((s) => s.fetchBooks);
  const { entries, total, isLoading, filterType, fetchEntries, loadMore, setFilterType } =
    useEntryStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const doFetch = useCallback(() => {
    if (currentBook) {
      fetchEntries(currentBook.id);
    }
  }, [currentBook, fetchEntries]);

  useEffect(() => {
    fetchBooks();
  }, []);

  // 页面聚焦时刷新
  useFocusEffect(
    useCallback(() => {
      doFetch();
    }, [doFetch])
  );

  // 切换筛选类型时刷新
  useEffect(() => {
    doFetch();
  }, [filterType]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await doFetch();
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (currentBook) loadMore(currentBook.id);
  };

  const handleEntryPress = (entry: EntryResponse) => {
    if (isDesktop) {
      setSelectedEntryId(entry.id);
    } else {
      router.push(`/entry/${entry.id}` as any);
    }
  };

  const groups = groupByDate(entries);

  const renderItem = ({ item }: { item: { date: string; items: EntryResponse[] } }) => (
    <View style={styles.group}>
      <Text style={[styles.dateHeader, { color: colors.textSecondary }]}>{item.date}</Text>
      {item.items.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onPress={() => handleEntryPress(entry)}
        />
      ))}
    </View>
  );

  const filterBar = (
    <View style={styles.tabs}>
      {FILTER_TABS.map((tab) => {
        const active = filterType === tab.key;
        return (
          <Pressable
            key={tab.key ?? 'all'}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => setFilterType(tab.key)}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const entryList = entries.length === 0 && !isLoading ? (
    <View style={styles.empty}>
      <FontAwesome name="book" size={48} color={colors.textSecondary} style={{ opacity: 0.3 }} />
      <Text style={[styles.emptyText, { color: colors.text }]}>暂无分录记录</Text>
      <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>记一笔账试试吧</Text>
    </View>
  ) : (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.date}
      renderItem={renderItem}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.3}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
      ListFooterComponent={
        isLoading && entries.length > 0 ? (
          <ActivityIndicator style={styles.footer} color={Colors.primary} />
        ) : null
      }
    />
  );

  const fab = (
    <Pressable
      style={[styles.fab, { backgroundColor: Colors.primary }]}
      onPress={() => router.push('/entry/new' as any)}
    >
      <FontAwesome name="plus" size={22} color="#FFFFFF" />
    </Pressable>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.desktopList, { borderRightColor: colors.border, backgroundColor: colors.background }]}>
          {filterBar}
          {entryList}
          {fab}
        </View>
        <View style={[styles.desktopDetail, { backgroundColor: colors.background }]}>
          {selectedEntryId ? (
            <EntryDetailPane entryId={selectedEntryId} colors={colors} />
          ) : (
            <View style={styles.detailCenter}>
              <FontAwesome name="file-text-o" size={48} color={colors.textSecondary} style={{ opacity: 0.3 }} />
              <Text style={[styles.detailPlaceholder, { color: colors.textSecondary }]}>
                选择左侧分录查看详情
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {filterBar}
      {entryList}
      {fab}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 13,
    opacity: 0.6,
  },
  tabTextActive: {
    color: '#FFFFFF',
    opacity: 1,
    fontWeight: '600',
  },
  group: {
    marginBottom: 4,
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
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
  footer: {
    paddingVertical: 16,
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
  // Desktop master-detail
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopList: {
    width: 380,
    borderRightWidth: 1,
  },
  desktopDetail: {
    flex: 1,
  },
  detailCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  detailPlaceholder: {
    fontSize: 14,
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    padding: 24,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  detailSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 8,
  },
  detailCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  detailLabel: {
    fontSize: 14,
    width: 80,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  lineHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  lineHeaderCell: {
    fontSize: 12,
    fontWeight: '600',
  },
  lineRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineCell: {
    fontSize: 13,
  },
  lineAccount: {
    flex: 1,
  },
  lineAmount: {
    width: 80,
    textAlign: 'right',
  },
});
