import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { bookService, type BookMemberResponse } from '@/services/bookService';

type Props = {
  bookId: string;
  isAdmin: boolean;
  ownerId: string;
  onMembersLoaded?: (members: BookMemberResponse[]) => void;
};

export function MemberList({ bookId, isAdmin, ownerId, onMembersLoaded }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [members, setMembers] = useState<BookMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = () => {
    setLoading(true);
    bookService
      .getMembers(bookId)
      .then(({ data }) => {
        setMembers(data);
        onMembersLoaded?.(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMembers();
  }, [bookId]);

  const handleRemove = async (userId: string) => {
    try {
      await bookService.removeMember(bookId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {
      // handled by caller
    }
  };

  const handleRoleChange = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    try {
      const { data } = await bookService.updateMemberRole(bookId, userId, {
        role: newRole as 'admin' | 'member',
      });
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? data : m)));
    } catch {
      // handled by caller
    }
  };

  /** 外部调用：添加成员后刷新列表 */
  const addMember = (member: BookMemberResponse) => {
    setMembers((prev) => [...prev, member]);
  };

  if (loading) {
    return (
      <View style={s.loadingRow}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View>
      {members.map((m) => (
        <View key={m.user_id} style={[s.memberRow, { borderBottomColor: colors.border }]}>
          {/* 头像 */}
          <View style={[s.avatar, { backgroundColor: m.is_owner ? Colors.primary : colors.border }]}>
            <Text style={s.avatarText}>
              {(m.nickname || m.email)[0].toUpperCase()}
            </Text>
          </View>

          {/* 信息 */}
          <View style={s.info}>
            <View style={s.nameRow}>
              <Text style={[s.memberName, { color: colors.text }]} numberOfLines={1}>
                {m.nickname || m.email.split('@')[0]}
              </Text>
              {m.is_owner && (
                <View style={s.ownerBadge}>
                  <Text style={s.ownerBadgeText}>创建者</Text>
                </View>
              )}
            </View>
            <Text style={[s.memberEmail, { color: colors.textSecondary }]} numberOfLines={1}>
              {m.email}
            </Text>
          </View>

          {/* 角色标签 */}
          <Pressable
            disabled={!isAdmin || m.is_owner}
            onPress={() => handleRoleChange(m.user_id, m.role)}
            style={[
              s.roleChip,
              m.role === 'admin'
                ? { backgroundColor: Colors.primary + '18', borderColor: Colors.primary }
                : { backgroundColor: colors.border + '60', borderColor: colors.border },
              (!isAdmin || m.is_owner) && { opacity: 0.6 },
            ]}
          >
            <Text
              style={[
                s.roleChipText,
                { color: m.role === 'admin' ? Colors.primary : colors.textSecondary },
              ]}
            >
              {m.role === 'admin' ? '管理员' : '成员'}
            </Text>
          </Pressable>

          {/* 移除按钮 */}
          {isAdmin && !m.is_owner && (
            <Pressable style={s.removeBtn} onPress={() => handleRemove(m.user_id)}>
              <FontAwesome name="times-circle" size={18} color="#EF4444" />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

// 暴露给父组件用 ref 添加成员
MemberList.addMember = undefined as any;

const s = StyleSheet.create({
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '500',
  },
  ownerBadge: {
    backgroundColor: Colors.primary + '18',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.primary,
  },
  memberEmail: {
    fontSize: 12,
    marginTop: 1,
  },
  roleChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginLeft: 8,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
