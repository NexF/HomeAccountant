import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import Sidebar from '@/components/layout/Sidebar';
import { useAuthStore } from '@/stores/authStore';
import { useBookStore } from '@/stores/bookStore';
import Colors from '@/constants/Colors';

export { ErrorBoundary } from 'expo-router';

// 自定义导航主题，确保页面背景色与 App 色彩体系一致
const AppLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.card,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.primary,
  },
};

const AppDarkTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background,
    card: Colors.dark.card,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: Colors.primary,
  },
};

export const unstable_settings = {
  initialRouteName: '(auth)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isDesktop } = useBreakpoint();
  const { isAuthenticated, isInitialized } = useAuthStore();
  const fetchBooks = useBookStore((s) => s.fetchBooks);
  const segments = useSegments();
  const router = useRouter();

  // Desktop keyboard shortcuts (N=new entry, Esc=back)
  useKeyboardShortcuts();

  // 登录后自动加载账本列表
  useEffect(() => {
    if (isAuthenticated) {
      fetchBooks();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isInitialized) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isInitialized, segments]);

  if (!isInitialized) {
    return (
      <View style={[styles.loading, { backgroundColor: colorScheme === 'dark' ? Colors.dark.background : Colors.light.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
      <View style={styles.root}>
        {isDesktop && isAuthenticated && <Sidebar />}
        <View style={styles.content}>
          <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="accounts/index" options={{ headerShown: false, title: '科目管理' }} />
            <Stack.Screen name="accounts/[id]" options={{ headerShown: false, title: '科目详情' }} />
            <Stack.Screen name="entry/new" options={{ headerShown: false, title: '记一笔' }} />
            <Stack.Screen name="entry/[id]" options={{ headerShown: false, title: '分录详情' }} />
            <Stack.Screen name="reports/balance-sheet" options={{ headerShown: false, title: '资产负债表' }} />
            <Stack.Screen name="reports/income-statement" options={{ headerShown: false, title: '损益表' }} />
            <Stack.Screen name="reports/trends" options={{ headerShown: false, title: '趋势分析' }} />
            <Stack.Screen name="sync/reconcile" options={{ headerShown: false, title: '待处理对账' }} />
            <Stack.Screen name="assets/index" options={{ headerShown: false, title: '固定资产' }} />
            <Stack.Screen name="assets/[id]" options={{ headerShown: false, title: '资产详情' }} />
            <Stack.Screen name="assets/new" options={{ headerShown: false, title: '新建固定资产' }} />
            <Stack.Screen name="loans/index" options={{ headerShown: false, title: '贷款管理' }} />
            <Stack.Screen name="loans/[id]" options={{ headerShown: false, title: '贷款详情' }} />
            <Stack.Screen name="loans/new" options={{ headerShown: false, title: '新建贷款' }} />
            <Stack.Screen name="settings/budget" options={{ headerShown: false, title: '预算设置' }} />
            <Stack.Screen name="settings/api-keys" options={{ headerShown: false, title: 'API Key 管理' }} />
            <Stack.Screen name="settings/plugins" options={{ headerShown: false, title: '插件管理' }} />
            <Stack.Screen name="settings/mcp" options={{ headerShown: false, title: 'MCP 服务' }} />
            <Stack.Screen name="profile/edit" options={{ headerShown: false, title: '编辑个人信息' }} />
            <Stack.Screen name="profile/settings" options={{ headerShown: false, title: '设置' }} />
          </Stack>
        </View>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
