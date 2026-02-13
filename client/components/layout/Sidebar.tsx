import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, usePathname } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type NavItem = {
  key: string;
  route: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
};

const NAV_ITEMS: NavItem[] = [
  { key: 'index', route: '/(tabs)', label: '总览', icon: 'home' },
  { key: 'ledger', route: '/(tabs)/ledger', label: '账本', icon: 'book' },
  { key: 'reports', route: '/(tabs)/reports', label: '报表', icon: 'bar-chart' },
  { key: 'profile', route: '/(tabs)/profile', label: '我的', icon: 'user' },
];

export default function Sidebar() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (item: NavItem) => {
    if (item.key === 'index') return pathname === '/' || pathname === '/(tabs)';
    return pathname.includes(item.key);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
          borderRightColor: colors.border,
        },
      ]}
    >
      {/* Logo */}
      <View style={styles.logoArea}>
        <FontAwesome name="calculator" size={24} color={Colors.primary} />
        <Text style={[styles.logoText, { color: colors.text }]}>家庭记账</Text>
      </View>

      {/* Nav Items */}
      <View style={styles.navList}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Pressable
              key={item.key}
              style={[
                styles.navItem,
                active && { backgroundColor: colorScheme === 'dark' ? '#312E81' : '#EEF2FF' },
              ]}
              onPress={() => router.push(item.route as any)}
            >
              <FontAwesome
                name={item.icon}
                size={20}
                color={active ? Colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.navLabel,
                  { color: active ? Colors.primary : colors.text },
                  active && styles.navLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Bottom: Settings */}
      <View style={styles.bottomArea}>
        <Pressable
          style={styles.navItem}
          onPress={() => router.push('/(tabs)/profile' as any)}
        >
          <FontAwesome name="cog" size={20} color={colors.textSecondary} />
          <Text style={[styles.navLabel, { color: colors.text }]}>设置</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 220,
    borderRightWidth: 1,
    paddingVertical: 16,
    justifyContent: 'flex-start',
  },
  logoArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
  },
  navList: {
    flex: 1,
    paddingTop: 8,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 8,
    marginBottom: 2,
  },
  navLabel: {
    fontSize: 15,
    marginLeft: 14,
  },
  navLabelActive: {
    fontWeight: '600',
  },
  bottomArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
  },
});
