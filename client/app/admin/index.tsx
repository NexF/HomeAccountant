import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAdminStore } from '@/stores/adminStore';
import { adminService, type AdminStats } from '@/services/adminService';
import Colors from '@/constants/Colors';

type StatCard = {
  label: string;
  value: number;
  sub?: string;
};

export default function AdminDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const { adminLogout } = useAdminStore();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminService.getStats();
      setStats(data);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        adminLogout();
        return;
      }
      setError(err?.response?.data?.detail || '获取统计数据失败');
    } finally {
      setLoading(false);
    }
  }, [adminLogout]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: Colors.asset, fontSize: 15 }}>{error}</Text>
      </View>
    );
  }

  if (!stats) return null;

  const cards: StatCard[] = [
    { label: '用户总数', value: stats.total_users, sub: `正常 ${stats.active_users} / 封禁 ${stats.banned_users}` },
    { label: '账本总数', value: stats.total_books, sub: `个人 ${stats.personal_books} / 家庭 ${stats.family_books}` },
    { label: '分录总数', value: stats.total_entries },
    { label: '今日新增用户', value: stats.today_new_users },
    { label: '今日新增分录', value: stats.today_new_entries },
    { label: '7日活跃用户', value: stats.weekly_active_users },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[s.scrollContent, { paddingHorizontal: isDesktop ? 32 : 16 }]}
    >
      {isDesktop && (
        <Text style={[s.pageTitle, { color: colors.text }]}>系统概览</Text>
      )}
      <View style={[s.grid, { gap: 12 }]}>
        {cards.map((card) => (
          <View
            key={card.label}
            style={[
              s.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                minWidth: isDesktop ? 200 : '46%' as any,
                flex: isDesktop ? undefined : 1,
              },
            ]}
          >
            <Text style={[s.cardLabel, { color: colors.textSecondary }]}>{card.label}</Text>
            <Text style={[s.cardValue, { color: colors.text }]}>
              {card.value.toLocaleString()}
            </Text>
            {card.sub && (
              <Text style={[s.cardSub, { color: colors.textSecondary }]}>{card.sub}</Text>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingTop: 24, paddingBottom: 40 },
  pageTitle: { fontSize: 20, fontWeight: '700', marginBottom: 20 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  card: {
    borderRadius: 12, borderWidth: 1, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  cardLabel: { fontSize: 13, fontWeight: '500', marginBottom: 8 },
  cardValue: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardSub: { fontSize: 12, marginTop: 6 },
});
