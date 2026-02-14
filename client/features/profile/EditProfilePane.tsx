import React, { useState } from 'react';
import { Pressable, Alert, Platform, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/authService';
import { styles } from './styles';

export default function EditProfilePane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await authService.updateProfile({ nickname: nickname || null });
      useAuthStore.setState({ user: data });
      if (Platform.OS === 'web') window.alert('保存成功');
      else Alert.alert('成功', '个人信息已更新');
    } catch {
      if (Platform.OS === 'web') window.alert('保存失败');
      else Alert.alert('错误', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>编辑个人信息</Text>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>邮箱</Text>
          <Text style={[styles.formValue, { color: colors.textSecondary }]}>{user?.email}</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>昵称</Text>
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={nickname}
            onChangeText={setNickname}
            placeholder="输入昵称"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>货币</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>{user?.currency ?? 'CNY'}</Text>
        </View>
      </View>
      <Pressable
        style={[styles.saveBtn, { backgroundColor: Colors.primary }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Text style={styles.saveBtnText}>保存</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
