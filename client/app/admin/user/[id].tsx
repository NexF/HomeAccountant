import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAdminStore } from '@/stores/adminStore';
import { adminService, type AdminUserItem } from '@/services/adminService';
import Colors from '@/constants/Colors';

export default function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const { adminLogout } = useAdminStore();
  const router = useRouter();

  const [user, setUser] = useState<AdminUserItem | null>(null);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showBanModal, setShowBanModal] = useState(false);
  const [banLoading, setBanLoading] = useState(false);

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    }
  };

  const fetchUser = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await adminService.getUser(id);
      setUser(data);
      setNickname(data.nickname || '');
    } catch (err: any) {
      if (err?.response?.status === 401) adminLogout();
    } finally {
      setLoading(false);
    }
  }, [id, adminLogout]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleSave = async () => {
    if (!id || !nickname.trim()) return;
    setSaving(true);
    try {
      const { data } = await adminService.updateUser(id, { nickname: nickname.trim() });
      setUser(data);
      showToast('成功', '昵称已更新');
    } catch (err: any) {
      showToast('失败', err?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleBanToggle = async () => {
    if (!id || !user) return;
    setBanLoading(true);
    try {
      const action = user.is_active ? adminService.banUser : adminService.unbanUser;
      const { data } = await action(id);
      setUser(data);
      setShowBanModal(false);
      showToast('成功', user.is_active ? '已封禁' : '已解封');
    } catch (err: any) {
      showToast('失败', err?.response?.data?.detail || '操作失败');
    } finally {
      setBanLoading(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('zh-CN');
  };

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>用户不存在</Text>
      </View>
    );
  }

  const isBanned = !user.is_active;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Toast */}
      {toastMsg ? (
        <View style={s.toast}>
          <Text style={s.toastText}>{toastMsg}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={[s.scrollContent, { paddingHorizontal: isDesktop ? 32 : 16 }]}>
        {/* 返回 + 标题 */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <FontAwesome name="chevron-left" size={16} color={colors.text} />
          </Pressable>
          <Text style={[s.pageTitle, { color: colors.text }]}>用户详情</Text>
          <View style={s.backBtn} />
        </View>

        {/* 头像 */}
        <View style={s.avatarSection}>
          <View style={[s.avatar, { backgroundColor: isBanned ? '#EF444420' : Colors.primary + '20' }]}>
            <Text style={{ fontSize: 32, fontWeight: '700', color: isBanned ? '#EF4444' : Colors.primary }}>
              {(user.nickname || user.email)[0].toUpperCase()}
            </Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: isBanned ? '#EF444420' : '#10B98120' }]}>
            <Text style={{ fontSize: 13, color: isBanned ? '#EF4444' : '#10B981', fontWeight: '600' }}>
              {isBanned ? '已封禁' : '正常'}
            </Text>
          </View>
        </View>

        {/* 信息 */}
        <View style={[s.field, { borderBottomColor: colors.border }]}>
          <Text style={[s.label, { color: colors.textSecondary }]}>邮箱</Text>
          <Text style={[s.value, { color: colors.text }]}>{user.email}</Text>
        </View>

        <View style={[s.field, { borderBottomColor: colors.border }]}>
          <Text style={[s.label, { color: colors.textSecondary }]}>昵称</Text>
          <TextInput
            style={[s.input, {
              color: colors.text,
              backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6',
              borderColor: colors.border,
            }]}
            value={nickname}
            onChangeText={setNickname}
            placeholder="输入昵称"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={[s.field, { borderBottomColor: colors.border }]}>
          <Text style={[s.label, { color: colors.textSecondary }]}>注册时间</Text>
          <Text style={[s.value, { color: colors.text }]}>{formatDate(user.created_at)}</Text>
        </View>

        <View style={[s.field, { borderBottomColor: colors.border }]}>
          <Text style={[s.label, { color: colors.textSecondary }]}>最后活跃</Text>
          <Text style={[s.value, { color: colors.text }]}>{formatDate(user.last_active_at)}</Text>
        </View>

        <View style={[s.field, { borderBottomColor: colors.border }]}>
          <Text style={[s.label, { color: colors.textSecondary }]}>账本数</Text>
          <Text style={[s.value, { color: colors.text }]}>{user.book_count}</Text>
        </View>

        {/* 保存 */}
        <Pressable
          style={[s.saveBtn, {
            backgroundColor: nickname.trim() && nickname !== user.nickname ? Colors.primary : colors.border,
          }]}
          onPress={handleSave}
          disabled={!nickname.trim() || nickname === user.nickname || saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Text style={s.saveBtnText}>保存修改</Text>
          )}
        </Pressable>

        {/* 危险操作 */}
        <View style={[s.dangerSection, { borderTopColor: colors.border }]}>
          <Text style={[s.dangerTitle, { color: colors.textSecondary }]}>危险操作</Text>
          <Pressable
            style={[s.dangerBtn, { backgroundColor: isBanned ? '#10B98120' : '#EF444415' }]}
            onPress={() => setShowBanModal(true)}
          >
            <Text style={{ color: isBanned ? '#10B981' : '#EF4444', fontWeight: '600', fontSize: 15 }}>
              {isBanned ? '解封用户' : '封禁用户'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* 封禁/解封确认弹窗 — DESIGN_GUIDELINES 规范 */}
      <Modal visible={showBanModal} transparent animationType="fade" onRequestClose={() => setShowBanModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowBanModal(false)}>
          <Pressable style={[s.modalCard, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[s.modalTitle, { color: colors.text }]}>
              {isBanned ? '解封用户' : '封禁用户'}
            </Text>
            <Text style={[s.modalMsg, { color: colors.textSecondary }]}>
              {isBanned
                ? `确定要解封「${user.nickname || user.email}」吗？\n解封后该用户可正常登录使用`
                : `确定要封禁「${user.nickname || user.email}」吗？\n封禁后该用户将无法登录`
              }
            </Text>
            <View style={s.modalBtnRow}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6' }]}
                onPress={() => setShowBanModal(false)}
              >
                <Text style={[s.modalBtnText, { color: colors.text }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: isBanned ? '#10B981' : '#EF4444' }]}
                onPress={handleBanToggle}
                disabled={banLoading}
              >
                {banLoading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={[s.modalBtnText, { color: '#FFF' }]}>
                    {isBanned ? '解封' : '封禁'}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingTop: 16, paddingBottom: 60 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', flex: 1 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  field: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  value: { fontSize: 15 },
  input: {
    height: 42, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15,
  },
  saveBtn: {
    height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    marginTop: 24,
  },
  saveBtnText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  dangerSection: { marginTop: 32, paddingTop: 20, borderTopWidth: 1 },
  dangerTitle: { fontSize: 13, fontWeight: '600', marginBottom: 12 },
  dangerBtn: {
    height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  // Toast
  toast: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    backgroundColor: '#EF4444', paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center',
  },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  // Modal — DESIGN_GUIDELINES 规范
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalCard: {
    width: '85%' as any, maxWidth: 420,
    borderRadius: 14, padding: 24,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  modalMsg: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  modalBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  modalBtnText: { fontSize: 15, fontWeight: '600' },
});
