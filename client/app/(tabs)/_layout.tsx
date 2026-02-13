import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useBreakpoint } from '@/hooks/useBreakpoint';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const clientOnlyHeaderShown = useClientOnlyValue(false, true);

  const headerShown = isDesktop ? false : clientOnlyHeaderShown;

  return (
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
        headerTitleAlign: 'center',
        headerTintColor: colors.text,
        headerShown,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '总览',
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ledger"
        options={{
          title: '账本',
          tabBarIcon: ({ color }) => <TabBarIcon name="book" color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: '报表',
          tabBarIcon: ({ color }) => <TabBarIcon name="bar-chart" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
        }}
      />
    </Tabs>
  );
}
