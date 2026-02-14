import React, { useCallback, useState } from 'react';
import { Pressable, Alert, Platform, ScrollView } from 'react-native';
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

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const { isDesktop } = useBreakpoint();

  const [activeDetail, setActiveDetail] = useState<DetailPane>('none');

  const consumePendingPane = useProfileNavStore((s) => s.consume);
  useFocusEffect(
    useCallback(() => {
      const pane = consumePendingPane();
      if (isDesktop) {
        setActiveDetail(pane ? (pane as DetailPane) : 'none');
      }
    }, [consumePendingPane, isDesktop])
  );

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('确定要退出登录吗？')) {
        logout();
      }
    } else {
      Alert.alert('退出登录', '确定要退出登录吗？', [
        { text: '取消', style: 'cancel' },
        { text: '退出', style: 'destructive', onPress: logout },
      ]);
    }
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
          {activeDetail === 'none' && (
            <View style={styles.detailEmpty}>
              <FontAwesome name="user-circle" size={48} color={colors.textSecondary} />
              <Text style={[styles.detailEmptyText, { color: colors.textSecondary }]}>
                选择左侧菜单项查看详情
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return <View style={styles.container}>{menuContent}</View>;
}
