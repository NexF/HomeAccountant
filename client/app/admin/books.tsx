import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList,
  StyleSheet, ActivityIndicator,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAdminStore } from '@/stores/adminStore';
import { adminService, type AdminBookItem } from '@/services/adminService';
import Colors from '@/constants/Colors';

const BOOK_TYPE_LABEL: Record<string, string> = {
  personal: '个人',
  family: '家庭',
};

export default function AdminBooks() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const { adminLogout } = useAdminStore();

  const [books, setBooks] = useState<AdminBookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchBooks = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await adminService.getBooks({
        page: p,
        page_size: 20,
        search: search.trim() || undefined,
      });
      setBooks(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (err: any) {
      if (err?.response?.status === 401) adminLogout();
    } finally {
      setLoading(false);
    }
  }, [search, adminLogout]);

  useEffect(() => {
    fetchBooks(1);
  }, [fetchBooks]);

  const totalPages = Math.ceil(total / 20);

  const formatDate = (d: string) => new Date(d).toLocaleDateString('zh-CN');

  const renderBook = ({ item }: { item: AdminBookItem }) => (
    <View style={[s.bookRow, { borderBottomColor: colors.border }]}>
      <View style={[s.typeTag, { backgroundColor: item.type === 'family' ? '#8B5CF620' : Colors.primary + '15' }]}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: item.type === 'family' ? '#8B5CF6' : Colors.primary }}>
          {BOOK_TYPE_LABEL[item.type] || item.type}
        </Text>
      </View>
      <View style={s.bookInfo}>
        <Text style={[s.bookName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[s.bookMeta, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.owner_nickname || item.owner_email} · {item.member_count}人 · {item.entry_count}笔分录
        </Text>
        <Text style={[s.bookDate, { color: colors.textSecondary }]}>
          创建于 {formatDate(item.created_at)}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {isDesktop && <Text style={[s.pageTitle, { color: colors.text }]}>账本概览</Text>}

      {/* 搜索 */}
      <View style={[s.filterRow, { paddingHorizontal: isDesktop ? 32 : 16 }]}>
        <TextInput
          style={[s.searchInput, {
            color: colors.text,
            backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6',
            borderColor: colors.border,
          }]}
          placeholder="搜索账本名 / 拥有者"
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          renderItem={renderBook}
          contentContainerStyle={{ paddingHorizontal: isDesktop ? 32 : 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={{ color: colors.textSecondary, fontSize: 15 }}>暂无账本</Text>
            </View>
          }
        />
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <View style={[s.pagination, { borderTopColor: colors.border }]}>
          <Text
            style={[s.pageLink, { opacity: page <= 1 ? 0.3 : 1, color: Colors.primary }]}
            onPress={() => page > 1 && fetchBooks(page - 1)}
          >
            上一页
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            {page} / {totalPages}（共 {total} 本）
          </Text>
          <Text
            style={[s.pageLink, { opacity: page >= totalPages ? 0.3 : 1, color: Colors.primary }]}
            onPress={() => page < totalPages && fetchBooks(page + 1)}
          >
            下一页
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 32, paddingTop: 24, paddingBottom: 12 },
  filterRow: { paddingTop: 12, paddingBottom: 8 },
  searchInput: {
    height: 42, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15,
  },
  bookRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  typeTag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    alignSelf: 'flex-start', marginTop: 2,
  },
  bookInfo: { flex: 1 },
  bookName: { fontSize: 15, fontWeight: '600' },
  bookMeta: { fontSize: 13, marginTop: 3 },
  bookDate: { fontSize: 12, marginTop: 3 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  pagination: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 20, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth,
  },
  pageLink: { fontWeight: '600', fontSize: 14, paddingHorizontal: 12, paddingVertical: 6 },
});
