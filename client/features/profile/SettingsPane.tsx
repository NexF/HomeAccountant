import React from 'react';
import { ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { styles } from './styles';

export default function SettingsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>设置</Text>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>深色模式</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>跟随系统</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>货币显示</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>¥ (CNY)</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>通知</Text>
          <Text style={[styles.formValue, { color: colors.textSecondary }]}>即将推出</Text>
        </View>
      </View>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>版本</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>0.1.0</Text>
        </View>
      </View>
    </ScrollView>
  );
}
