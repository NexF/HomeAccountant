import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { TextInput } from '@/components/Themed';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { bookService, type BookMemberResponse } from '@/services/bookService';

type Props = {
  visible: boolean;
  bookId: string;
  onClose: () => void;
  onInvited: (member: BookMemberResponse) => void;
};

function showToast(msg: string) {
  if (Platform.OS === 'web') {
    window.alert(msg);
  } else {
    Alert.alert('提示', msg);
  }
}

export function InviteMemberModal({ visible, bookId, onClose, onInvited }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const { data } = await bookService.inviteMember(bookId, {
        email: email.trim(),
        role,
      });
      onInvited(data);
      setEmail('');
      setRole('member');
      onClose();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '邀请失败');
    } finally {
      setInviting(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setRole('member');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[styles.content, { backgroundColor: colors.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>邀请成员</Text>

          {/* 邮箱输入 */}
          <View style={styles.fieldRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>邮箱地址</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              value={email}
              onChangeText={setEmail}
              placeholder="user@example.com"
              placeholderTextColor={colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
          </View>

          {/* 角色选择 */}
          <View style={styles.fieldRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>角色</Text>
            <View style={styles.chipRow}>
              {(['member', 'admin'] as const).map((r) => {
                const active = role === r;
                return (
                  <Pressable
                    key={r}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? Colors.primary : colors.background,
                        borderColor: active ? Colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setRole(r)}
                  >
                    <Text
                      style={{
                        color: active ? '#FFFFFF' : colors.text,
                        fontSize: 14,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {r === 'member' ? '成员' : '管理员'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 按钮 */}
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.border }]}
              onPress={handleClose}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                styles.btn,
                { backgroundColor: email.trim() ? Colors.primary : colors.border },
              ]}
              onPress={handleInvite}
              disabled={!email.trim() || inviting}
            >
              {inviting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontWeight: '600' }}>发送邀请</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldRow: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
