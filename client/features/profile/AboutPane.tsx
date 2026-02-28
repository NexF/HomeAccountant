import React from 'react';
import { ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { styles } from './styles';

const APP_VERSION = '0.4.0';

export default function AboutPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>关于</Text>

      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            backgroundColor: Colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <FontAwesome name="home" size={32} color="#FFFFFF" />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
          咕咕记账
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          v{APP_VERSION}
        </Text>
      </View>

      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>版本</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>{APP_VERSION}</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>技术栈</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>Expo + FastAPI</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>数据库</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>SQLite</Text>
        </View>
      </View>

      <Text
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: colors.textSecondary,
          marginTop: 8,
          marginBottom: 24,
        }}
      >
        基于复式记账法的家庭财务管理工具
      </Text>
    </ScrollView>
  );
}
