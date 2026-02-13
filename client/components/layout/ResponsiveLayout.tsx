import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

type ResponsiveLayoutProps = {
  children: React.ReactNode;
  title?: string;
  onNewEntry?: () => void;
};

/**
 * 响应式布局容器
 * - 移动端（< 1024px）：直接渲染 children（由 Tabs 底部导航包裹）
 * - 桌面端（≥ 1024px）：左侧边栏 + 顶部栏 + 内容区
 */
export default function ResponsiveLayout({
  children,
  title,
  onNewEntry,
}: ResponsiveLayoutProps) {
  const { isDesktop } = useBreakpoint();
  const colorScheme = useColorScheme() ?? 'light';

  if (!isDesktop) {
    return <>{children}</>;
  }

  return (
    <View
      style={[
        styles.desktopContainer,
        { backgroundColor: Colors[colorScheme].background },
      ]}
    >
      <Sidebar />
      <View style={styles.mainArea}>
        <TopBar title={title} onNewEntry={onNewEntry} />
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  mainArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
