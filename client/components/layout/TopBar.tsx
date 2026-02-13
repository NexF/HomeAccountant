import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type TopBarProps = {
  title?: string;
  onNewEntry?: () => void;
};

export default function TopBar({ title = '总览', onNewEntry }: TopBarProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

      <Pressable
        style={[styles.newEntryBtn, { backgroundColor: Colors.primary }]}
        onPress={onNewEntry}
      >
        <FontAwesome name="plus" size={14} color="#FFFFFF" />
        <Text style={styles.newEntryText}>记账</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  newEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  newEntryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
