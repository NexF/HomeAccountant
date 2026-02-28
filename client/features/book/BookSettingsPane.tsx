import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { TextInput } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAuthStore } from '@/stores/authStore';
import { bookService } from '@/services/bookService';
import { MemberList } from './MemberList';
import { InviteMemberModal } from './InviteMemberModal';
import type { BookMemberResponse } from '@/services/bookService';

type Props = {
  onBack?: () => void;
  onBookDeleted?: () => void;
};

function showToast(msg: string) {
  if (Platform.OS === 'web') {
    window.alert(msg);
  } else {
    Alert.alert('提示', msg);
  }
}

export function BookSettingsPane({ onBack, onBookDeleted }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { currentBook, currentRole, updateBook, deleteBook, fetchBooks } = useBookStore();
  const user = useAuthStore((s) => s.user);

  const isAdmin = currentRole === 'admin';
  const isOwner = currentBook?.owner_id === user?.id;

  // 重命名
  const [editName, setEditName] = useState(currentBook?.name ?? '');
  const [saving, setSaving] = useState(false);

  // 邀请
  const [showInvite, setShowInvite] = useState(false);
  const [memberCount, setMemberCount] = useState(0);

  // 删除确认
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 退出确认
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleSaveName = async () => {
    if (!currentBook || !editName.trim() || editName.trim() === currentBook.name) return;
    setSaving(true);
    try {
      await updateBook(currentBook.id, editName.trim());
      showToast('账本名称已更新');
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!currentBook || confirmName !== currentBook.name) return;
    setDeleting(true);
    try {
      await deleteBook(currentBook.id);
      setShowDeleteConfirm(false);
      setConfirmName('');
      showToast('账本已删除');
      onBookDeleted?.();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleLeaveBook = async () => {
    if (!currentBook) return;
    setLeaving(true);
    try {
      await bookService.leaveBook(currentBook.id);
      setShowLeaveConfirm(false);
      await fetchBooks();
      showToast('已退出账本');
      onBookDeleted?.();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '退出失败');
    } finally {
      setLeaving(false);
    }
  };

  if (!currentBook) {
    return (
      <View style={s.emptyContainer}>
        <Text style={{ color: colors.textSecondary }}>请先选择一个账本</Text>
      </View>
    );
  }

  const canDelete = confirmName === currentBook.name;

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Header */}
        <View style={s.header}>
          {onBack && (
            <Pressable onPress={onBack} style={s.backBtn}>
              <FontAwesome name="arrow-left" size={16} color={colors.text} />
            </Pressable>
          )}
          <Text style={[s.title, { color: colors.text }]}>账本设置</Text>
        </View>

        {/* 账本名称 */}
        {isAdmin && (
          <View style={[s.card, { backgroundColor: colors.card }]}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>账本名称</Text>
            <View style={s.renameRow}>
              <TextInput
                style={[
                  s.nameInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                value={editName}
                onChangeText={setEditName}
                placeholder="输入账本名称"
                placeholderTextColor={colors.textSecondary}
              />
              <Pressable
                style={[
                  s.saveBtn,
                  {
                    backgroundColor:
                      editName.trim() && editName.trim() !== currentBook.name
                        ? Colors.primary
                        : colors.border,
                  },
                ]}
                onPress={handleSaveName}
                disabled={!editName.trim() || editName.trim() === currentBook.name || saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>保存</Text>
                )}
              </Pressable>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, { color: colors.textSecondary }]}>类型</Text>
              <Text style={[s.infoValue, { color: colors.text }]}>
                {currentBook.type === 'family' ? '家庭账本' : '个人账本'}
              </Text>
            </View>
            <View style={s.infoRow}>
              <Text style={[s.infoLabel, { color: colors.textSecondary }]}>创建时间</Text>
              <Text style={[s.infoValue, { color: colors.text }]}>
                {new Date(currentBook.created_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        )}

        {/* 成员管理 */}
        <View style={[s.card, { backgroundColor: colors.card }]}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>
              成员（{memberCount}）
            </Text>
            {isAdmin && currentBook.type === 'family' && (
              <Pressable style={s.inviteBtn} onPress={() => setShowInvite(true)}>
                <FontAwesome name="plus" size={12} color={Colors.primary} />
                <Text style={[s.inviteBtnText, { color: Colors.primary }]}>邀请</Text>
              </Pressable>
            )}
          </View>
          <MemberList
            bookId={currentBook.id}
            isAdmin={isAdmin}
            ownerId={currentBook.owner_id}
            onMembersLoaded={(members) => setMemberCount(members.length)}
          />
        </View>

        {/* 删除/退出账本 */}
        {isOwner ? (
          <Pressable
            style={s.dangerBtn}
            onPress={() => setShowDeleteConfirm(true)}
          >
            <FontAwesome name="trash" size={16} color="#FFF" />
            <Text style={s.dangerBtnText}>删除账本</Text>
          </Pressable>
        ) : (
          <Pressable
            style={s.dangerBtn}
            onPress={() => setShowLeaveConfirm(true)}
          >
            <FontAwesome name="sign-out" size={16} color="#FFF" />
            <Text style={s.dangerBtnText}>退出账本</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* 邀请成员 Modal */}
      <InviteMemberModal
        visible={showInvite}
        bookId={currentBook.id}
        onClose={() => setShowInvite(false)}
        onInvited={(member: BookMemberResponse) => {
          setMemberCount((c) => c + 1);
          showToast(`已添加 ${member.nickname || member.email} 为${member.role === 'admin' ? '管理员' : '成员'}`);
        }}
      />

      {/* 删除确认 Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowDeleteConfirm(false)}>
          <Pressable
            style={[s.modalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[s.modalTitle, { color: colors.text }]}>删除账本</Text>
            <Text style={[s.dangerText, { color: '#EF4444' }]}>
              此操作不可恢复！将永久删除账本「{currentBook.name}」及其所有科目、分录、预算等数据。
            </Text>
            <Text style={[s.confirmLabel, { color: colors.textSecondary }]}>
              请输入账本名称以确认：
            </Text>
            <TextInput
              style={[
                s.confirmInput,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              value={confirmName}
              onChangeText={setConfirmName}
              placeholder={currentBook.name}
              placeholderTextColor={colors.textSecondary}
            />
            <View style={s.modalBtnRow}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setConfirmName('');
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[
                  s.modalBtn,
                  { backgroundColor: canDelete ? '#EF4444' : colors.border },
                ]}
                onPress={handleDeleteBook}
                disabled={!canDelete || deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 退出确认 Modal */}
      <Modal
        visible={showLeaveConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLeaveConfirm(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowLeaveConfirm(false)}>
          <Pressable
            style={[s.modalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[s.modalTitle, { color: colors.text }]}>退出账本</Text>
            <Text style={[s.modalMsg, { color: colors.textSecondary }]}>
              确定要退出账本「{currentBook.name}」吗？退出后将无法查看该账本的数据。
            </Text>
            <View style={s.modalBtnRow}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setShowLeaveConfirm(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleLeaveBook}
                disabled={leaving}
              >
                {leaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>退出</Text>
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
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  renameRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  nameInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  saveBtn: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
  },
  inviteBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#EF4444',
  },
  dangerBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  dangerText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  confirmLabel: {
    fontSize: 13,
    marginBottom: 8,
  },
  confirmInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 16,
  },
  modalMsg: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
