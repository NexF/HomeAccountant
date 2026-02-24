import React, { useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, useRouter } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { BookSwitcher, CreateBookModal } from '@/features/book';
import { useBookStore } from '@/stores/bookStore';
import type { BookResponse } from '@/services/bookService';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

function HeaderBookSwitcher({ onCreateBook, onOpenSettings }: { onCreateBook: () => void; onOpenSettings: () => void }) {
  return (
    <View style={headerStyles.rightContainer}>
      <BookSwitcher
        onCreateBook={onCreateBook}
        onOpenSettings={onOpenSettings}
        compact
      />
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const clientOnlyHeaderShown = useClientOnlyValue(false, true);
  const [showCreateBookModal, setShowCreateBookModal] = useState(false);
  const { setCurrentBook } = useBookStore();

  const headerShown = isDesktop ? false : clientOnlyHeaderShown;

  const bookSwitcherRight = () => (
    <HeaderBookSwitcher
      onCreateBook={() => setShowCreateBookModal(true)}
      onOpenSettings={() => router.push('/settings/book' as any)}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      {/* 创建账本 Modal */}
      <CreateBookModal
        visible={showCreateBookModal}
        onClose={() => setShowCreateBookModal(false)}
        onCreated={(book: BookResponse) => {
          setCurrentBook(book);
        }}
      />

      <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: isDesktop
          ? { display: 'none' }
          : {
              backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
              borderTopColor: colors.border,
              height: 60,
            },
        headerStyle: {
          backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
          height: 60,
        },
        headerTitleStyle: {
          fontSize: 17,
          fontWeight: '600',
        },
        headerTitleAlign: 'left',
        headerTintColor: colors.text,
        headerShown,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '总览',
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
          headerRight: bookSwitcherRight,
        }}
      />
      <Tabs.Screen
        name="ledger"
        options={{
          title: '账本',
          tabBarIcon: ({ color }) => <TabBarIcon name="book" color={color} />,
          headerRight: bookSwitcherRight,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: '报表',
          tabBarIcon: ({ color }) => <TabBarIcon name="bar-chart" color={color} />,
          headerRight: bookSwitcherRight,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
          headerRight: bookSwitcherRight,
        }}
      />
    </Tabs>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  rightContainer: {
    marginRight: 12,
  },
});
