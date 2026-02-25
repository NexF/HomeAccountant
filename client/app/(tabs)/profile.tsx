import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthStore } from '@/stores/authStore';
import { useProfileNavStore } from '@/stores/profileNavStore';
import { useBreakpoint } from '@/hooks/useBreakpoint';

import { MenuItem, EditProfilePane, SettingsPane, styles } from '@/features/profile';
import type { DetailPane } from '@/features/profile';
import { AccountsPane } from '@/features/account';
import { AssetsPane } from '@/features/asset';
import { LoansPane } from '@/features/loan';
import { BudgetPane } from '@/features/budget';
import { ApiKeysPane } from '@/features/api-key';
import { PluginsPane } from '@/features/plugin';
import { MCPPane } from '@/features/mcp';
import { BookSettingsPane } from '@/features/book';

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const { isDesktop } = useBreakpoint();

  const [activeDetail, setActiveDetail] = useState<DetailPane>('none');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const focusedRef = useRef(false);

  // 追踪 tab 聚焦/失焦状态，聚焦时处理 pendingPane 或重置
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;

      if (isDesktop) {
        const pane = useProfileNavStore.getState().pendingPane;
        if (pane) {
          useProfileNavStore.getState().consume();
          setActiveDetail(pane as DetailPane);
        } else {
          setActiveDetail('none');
        }
      }

      return () => {
        focusedRef.current = false;
      };
    }, [isDesktop])
  );

  // 已在 profile 页面时，响应来自 Sidebar 的 navigateTo
  // 使用 zustand subscribe 绕过 React 渲染周期的时序问题
  useEffect(() => {
    if (!isDesktop) return;
    const unsub = useProfileNavStore.subscribe((state) => {
      if (focusedRef.current && state.pendingPane) {
        const pane = useProfileNavStore.getState().consume();
        if (pane) {
          setActiveDetail(pane as DetailPane);
        }
      }
    });
    return unsub;
  }, [isDesktop]);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  const handleMenuPress = (pane: DetailPane, mobileRoute: string) => {
    if (isDesktop) {
      setActiveDetail(pane);
    } else {
      router.push(mobileRoute as any);
    }
  };

  const menuContent = (
    <ScrollView style={styles.menuScroll}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <FontAwesome name="user" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.name}>{user?.nickname || '用户'}</Text>
        <Text style={[styles.email, { color: colors.textSecondary }]}>{user?.email}</Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="pencil"
          label="编辑个人信息"
          onPress={() => handleMenuPress('edit-profile', '/profile/edit')}
        />
        <MenuItem
          icon="book"
          label="账本设置"
          onPress={() => handleMenuPress('book-settings', '/settings/book')}
        />
        <MenuItem
          icon="list-alt"
          label="科目管理"
          onPress={() => handleMenuPress('accounts', '/accounts')}
        />
        <MenuItem
          icon="key"
          label="API Key 管理"
          onPress={() => handleMenuPress('api-keys', '/settings/api-keys')}
        />
        <MenuItem
          icon="puzzle-piece"
          label="插件管理"
          onPress={() => handleMenuPress('plugins', '/settings/plugins')}
        />
        <MenuItem
          icon="microchip"
          label="MCP 服务"
          onPress={() => handleMenuPress('mcp', '/settings/mcp')}
        />
        <MenuItem icon="bank" label="外部账户" hint="即将推出" />
        <MenuItem icon="building" label="固定资产" onPress={() => handleMenuPress('assets', '/assets')} />
        <MenuItem icon="credit-card" label="贷款管理" onPress={() => handleMenuPress('loans', '/loans')} />
        <MenuItem icon="pie-chart" label="预算设置" onPress={() => handleMenuPress('budget', '/settings/budget')} />
        <MenuItem icon="download" label="数据导入/导出" hint="即将推出" />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="cog"
          label="设置"
          color={Colors.neutral}
          onPress={() => handleMenuPress('settings', '/profile/settings')}
        />
        <MenuItem icon="info-circle" label="关于" color={Colors.neutral} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="sign-out"
          label="退出登录"
          color={Colors.asset}
          onPress={handleLogout}
        />
      </View>
    </ScrollView>
  );

  const logoutModal = (
    <Modal
      visible={showLogoutConfirm}
      transparent
      animationType="fade"
      onRequestClose={() => setShowLogoutConfirm(false)}
    >
      <Pressable style={ms.overlay} onPress={() => setShowLogoutConfirm(false)}>
        <Pressable
          style={[ms.content, { backgroundColor: colors.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[ms.title, { color: colors.text }]}>退出登录</Text>
          <Text style={[ms.msg, { color: colors.textSecondary }]}>
            确定要退出登录吗？
          </Text>
          <View style={ms.btnRow}>
            <Pressable
              style={[ms.btn, { backgroundColor: colors.border }]}
              onPress={() => setShowLogoutConfirm(false)}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              style={[ms.btn, { backgroundColor: '#EF4444' }]}
              onPress={confirmLogout}
            >
              <Text style={{ color: '#FFF', fontWeight: '600' }}>退出</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopContainer}>
        <View style={[styles.desktopMenu, { borderRightColor: colors.border }]}>
          {menuContent}
        </View>
        <View style={styles.desktopDetail}>
          {activeDetail === 'edit-profile' && <EditProfilePane />}
          {activeDetail === 'settings' && <SettingsPane />}
          {activeDetail === 'accounts' && <AccountsPane />}
          {activeDetail === 'assets' && <AssetsPane />}
          {activeDetail === 'loans' && <LoansPane />}
          {activeDetail === 'budget' && <BudgetPane />}
          {activeDetail === 'api-keys' && <ApiKeysPane />}
          {activeDetail === 'plugins' && <PluginsPane />}
          {activeDetail === 'mcp' && <MCPPane onNavigate={setActiveDetail} />}
          {activeDetail === 'book-settings' && (
            <BookSettingsPane
              onBookDeleted={() => setActiveDetail('none')}
            />
          )}
          {activeDetail === 'none' && (
            <View style={styles.detailEmpty}>
              <FontAwesome name="user-circle" size={48} color={colors.textSecondary} />
              <Text style={[styles.detailEmptyText, { color: colors.textSecondary }]}>
                选择左侧菜单项查看详情
              </Text>
            </View>
          )}
        </View>
        {logoutModal}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {menuContent}
      {logoutModal}
    </View>
  );
}

const ms = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  msg: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
