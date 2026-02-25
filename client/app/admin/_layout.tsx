import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';

import { useAdminStore } from '@/stores/adminStore';
import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import Colors from '@/constants/Colors';

const NAV_ITEMS = [
  { key: 'index', label: '概览', path: '/admin' },
  { key: 'users', label: '用户', path: '/admin/users' },
  { key: 'books', label: '账本', path: '/admin/books' },
];

export default function AdminLayout() {
  const { isAdminAuth, adminLogin, adminLogout, isLoading, error } = useAdminStore();
  const [password, setPassword] = useState('');
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const pathname = usePathname();

  // 未验证：显示密码输入页
  if (!isAdminAuth) {
    return (
      <View style={[s.loginContainer, { backgroundColor: colors.background }]}>
        <View style={[s.loginCard, { backgroundColor: colors.card }]}>
          <Text style={[s.loginTitle, { color: colors.text }]}>管理后台</Text>
          <TextInput
            style={[s.loginInput, {
              color: colors.text,
              backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6',
              borderColor: colors.border,
            }]}
            placeholder="请输入管理密码"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            onSubmitEditing={() => password.trim() && adminLogin(password.trim())}
          />
          {error && <Text style={s.errorText}>{error}</Text>}
          <Pressable
            style={[s.loginBtn, {
              backgroundColor: password.trim() ? Colors.primary : colors.border,
            }]}
            onPress={() => password.trim() && adminLogin(password.trim())}
            disabled={!password.trim() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={s.loginBtnText}>进入后台</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // 已验证 — 桌面端双栏 / 移动端顶部 Tab
  if (isDesktop) {
    return (
      <View style={[s.desktopContainer, { backgroundColor: colors.background }]}>
        <View style={[s.sidebar, { borderRightColor: colors.border }]}>
          <Text style={[s.sidebarTitle, { color: colors.text }]}>管理后台</Text>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.path || (item.key === 'index' && pathname === '/admin');
            return (
              <Pressable
                key={item.key}
                style={[s.navItem, active && { backgroundColor: Colors.primary + '15' }]}
                onPress={() => router.push(item.path as any)}
              >
                <Text style={[s.navText, { color: active ? Colors.primary : colors.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          <Pressable style={[s.navItem, { marginBottom: 16 }]} onPress={adminLogout}>
            <Text style={[s.navText, { color: Colors.asset }]}>退出管理</Text>
          </Pressable>
        </View>
        <View style={s.mainContent}>
          <Slot />
        </View>
      </View>
    );
  }

  // 移动端：顶部 Tab
  return (
    <View style={[s.mobileContainer, { backgroundColor: colors.background }]}>
      <View style={[s.topBar, { borderBottomColor: colors.border }]}>
        <Text style={[s.topBarTitle, { color: colors.text }]}>管理后台</Text>
        <Pressable onPress={adminLogout} style={s.logoutBtn}>
          <Text style={{ color: Colors.asset, fontSize: 14, fontWeight: '500' }}>退出</Text>
        </Pressable>
      </View>
      <View style={[s.topTabs, { borderBottomColor: colors.border }]}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.path || (item.key === 'index' && pathname === '/admin');
          return (
            <Pressable
              key={item.key}
              style={[s.tab, active && { borderBottomColor: Colors.primary, borderBottomWidth: 2 }]}
              onPress={() => router.push(item.path as any)}
            >
              <Text style={[s.tabText, { color: active ? Colors.primary : colors.textSecondary }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Slot />
    </View>
  );
}

const s = StyleSheet.create({
  // 登录页
  loginContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loginCard: {
    width: '85%' as any,
    maxWidth: 420,
    borderRadius: 14,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  loginTitle: { fontSize: 24, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  loginInput: {
    height: 48, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 16, marginBottom: 12,
  },
  errorText: { color: '#EF4444', fontSize: 13, marginBottom: 12 },
  loginBtn: {
    height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  loginBtnText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  // 桌面端
  desktopContainer: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 200, borderRightWidth: 1, paddingTop: 20, paddingHorizontal: 12 },
  sidebarTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20, paddingHorizontal: 8 },
  navItem: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginBottom: 4 },
  navText: { fontSize: 15, fontWeight: '500' },
  mainContent: { flex: 1 },
  // 移动端
  mobileContainer: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: Platform.OS === 'web' ? 16 : 52, paddingBottom: 12,
    paddingHorizontal: 16, borderBottomWidth: 1,
  },
  topBarTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', flex: 1 },
  logoutBtn: { position: 'absolute', right: 16, bottom: 12 },
  topTabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 15, fontWeight: '600' },
});
