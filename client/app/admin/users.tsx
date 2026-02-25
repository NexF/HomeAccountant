import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAdminStore } from '@/stores/adminStore';
import { adminService, type AdminUserItem } from '@/services/adminService';
import Colors from '@/constants/Colors';

const STATUS_FILTERS = [
  { key: undefined as string | undefined, label: '全部' },
  { key: 'active', label: '正常' },
  { key: 'banned', label: '已封禁' },
];

export default function AdminUsers() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const { adminLogout } = useAdminStore();
  const router = useRouter();

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await adminService.getUsers({
        page: p,
        page_size: 20,
        search: search.trim() || undefined,
        status: statusFilter as any,
      });
      setUsers(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (err: any) {
      if (err?.response?.status === 401) adminLogout();
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, adminLogout]);

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / 20);

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('zh-CN');
  };

  const renderUser = ({ item }: { item: AdminUserItem }) => (
    <Pressable
      style={[s.userRow, { borderBottomColor: colors.border }]}
      onPress={() => router.push(`/admin/user/${item.id}` as any)}
    >
      <View style={[s.avatar, { backgroundColor: item.is_active ? Colors.primary + '20' : '#EF444420' }]}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: item.is_active ? Colors.primary : '#EF4444' }}>
          {(item.nickname || item.email)[0].toUpperCase()}
        </Text>
      </View>
      <View style={s.userInfo}>
        <View style={s.userNameRow}>
          <Text style={[s.userName, { color: colors.text }]} numberOfLines={1}>
            {item.nickname || '未设置昵称'}
          </Text>
          <View style={[s.statusBadge, { backgroundColor: item.is_active ? '#10B98120' : '#EF444420' }]}>
            <Text style={{ fontSize: 11, color: item.is_active ? '#10B981' : '#EF4444', fontWeight: '600' }}>
              {item.is_active ? '正常' : '已封禁'}
            </Text>
          </View>
        </View>
        <Text style={[s.userEmail, { color: colors.textSecondary }]} numberOfLines={1}>{item.email}</Text>
        <Text style={[s.userMeta, { color: colors.textSecondary }]}>
          {item.book_count}个账本 · 注册 {formatDate(item.created_at)} · 活跃 {formatDate(item.last_active_at)}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {isDesktop && <Text style={[s.pageTitle, { color: colors.text }]}>用户管理</Text>}

      {/* 搜索 + 状态筛选 */}
      <View style={[s.filterRow, { paddingHorizontal: isDesktop ? 32 : 16 }]}>
        <TextInput
          style={[s.searchInput, {
            color: colors.text,
            backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6',
            borderColor: colors.border,
          }]}
          placeholder="搜索邮箱 / 昵称"
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        <View style={s.chipRow}>
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            return (
              <Pressable
                key={f.label}
                style={[s.chip, {
                  backgroundColor: active ? Colors.primary : 'transparent',
                  borderColor: active ? Colors.primary : colors.border,
                }]}
                onPress={() => setStatusFilter(f.key)}
              >
                <Text style={{ fontSize: 13, color: active ? '#FFF' : colors.textSecondary, fontWeight: '500' }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={{ paddingHorizontal: isDesktop ? 32 : 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={{ color: colors.textSecondary, fontSize: 15 }}>暂无用户</Text>
            </View>
          }
        />
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <View style={[s.pagination, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={() => page > 1 && fetchUsers(page - 1)}
            disabled={page <= 1}
            style={[s.pageBtn, { opacity: page <= 1 ? 0.3 : 1 }]}
          >
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>上一页</Text>
          </Pressable>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            {page} / {totalPages}（共 {total} 人）
          </Text>
          <Pressable
            onPress={() => page < totalPages && fetchUsers(page + 1)}
            disabled={page >= totalPages}
            style={[s.pageBtn, { opacity: page >= totalPages ? 0.3 : 1 }]}
          >
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>下一页</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 32, paddingTop: 24, paddingBottom: 12 },
  filterRow: { paddingTop: 12, paddingBottom: 8, gap: 8 },
  searchInput: {
    height: 42, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15,
  },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
  },
  userRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { fontSize: 15, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  userEmail: { fontSize: 13, marginTop: 2 },
  userMeta: { fontSize: 12, marginTop: 4 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  pagination: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 20, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth,
  },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 6 },
});
