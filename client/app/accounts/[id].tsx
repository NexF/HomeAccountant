import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAccountStore, ACCOUNT_TYPE_LABELS, type AccountType } from '@/stores/accountStore';
import { accountService, type AccountTreeNode } from '@/services/accountService';
import { useBookStore } from '@/stores/bookStore';
import { syncService } from '@/services/syncService';

const DIRECTION_LABEL: Record<string, string> = {
  debit: '借方',
  credit: '贷方',
};

function findNodeById(nodes: AccountTreeNode[], id: string): AccountTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

export default function AccountDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tree, fetchTree } = useAccountStore();
  const { currentBook } = useBookStore();

  const [account, setAccount] = useState<AccountTreeNode | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 更新真实余额
  const [realBalance, setRealBalance] = useState('');
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    if (!tree || !id) return;
    const allNodes = [
      ...(tree.asset ?? []),
      ...(tree.liability ?? []),
      ...(tree.equity ?? []),
      ...(tree.income ?? []),
      ...(tree.expense ?? []),
    ];
    const found = findNodeById(allNodes, id);
    if (found) {
      setAccount(found);
      setName(found.name);
      setIcon(found.icon ?? '');
      setSortOrder(String(found.sort_order));
    }
  }, [tree, id]);

  const handleSave = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const params: Record<string, any> = {};
      if (name !== account.name) params.name = name;
      if (icon !== (account.icon ?? '')) params.icon = icon || null;
      if (Number(sortOrder) !== account.sort_order) params.sort_order = Number(sortOrder);

      if (Object.keys(params).length === 0) {
        setSaving(false);
        return;
      }

      await accountService.updateAccount(account.id, params);
      if (currentBook) await fetchTree(currentBook.id);
      setDirty(false);

      if (Platform.OS === 'web') {
        window.alert('保存成功');
      } else {
        Alert.alert('成功', '科目已更新');
      }
    } catch {
      if (Platform.OS === 'web') {
        window.alert('保存失败');
      } else {
        Alert.alert('错误', '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSnapshot = async () => {
    if (!account || !realBalance.trim()) return;
    const val = parseFloat(realBalance);
    if (isNaN(val)) {
      if (Platform.OS === 'web') window.alert('请输入有效金额');
      else Alert.alert('错误', '请输入有效金额');
      return;
    }
    setSnapshotLoading(true);
    try {
      const { data } = await syncService.submitSnapshot(account.id, val);
      setRealBalance('');
      if (data.status === 'balanced') {
        if (Platform.OS === 'web') window.alert('余额一致，无需调节');
        else Alert.alert('成功', '余额一致，无需调节');
      } else {
        const diffStr = Math.abs(data.difference).toFixed(2);
        const msg = `差异 ¥${diffStr}，已生成待分类调节分录`;
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('已生成调节分录', msg);
      }
    } catch {
      if (Platform.OS === 'web') window.alert('提交失败');
      else Alert.alert('错误', '提交失败');
    } finally {
      setSnapshotLoading(false);
    }
  };

  const isBalanceAccount = account?.type === 'asset' || account?.type === 'liability';

  if (!account) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>科目详情</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Info Card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>编码</Text>
            <Text style={styles.infoValue}>{account.code}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>类型</Text>
            <Text style={styles.infoValue}>
              {ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>余额方向</Text>
            <Text style={styles.infoValue}>
              {DIRECTION_LABEL[account.balance_direction]}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>来源</Text>
            <Text style={styles.infoValue}>
              {account.is_system ? '系统预置' : '用户自定义'}
            </Text>
          </View>
        </View>

        {/* Editable fields */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {account.is_system ? '可编辑字段（系统科目仅可改名称/图标）' : '编辑科目'}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>名称</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setDirty(true);
              }}
              placeholder="科目名称"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>图标</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              value={icon}
              onChangeText={(v) => {
                setIcon(v);
                setDirty(true);
              }}
              placeholder="FontAwesome 图标名"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>排序</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              value={sortOrder}
              onChangeText={(v) => {
                setSortOrder(v);
                setDirty(true);
              }}
              keyboardType="numeric"
              placeholder="排序号"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        {/* Save Button */}
        <Pressable
          style={[
            styles.saveBtn,
            { backgroundColor: dirty ? Colors.primary : colors.border },
          ]}
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>保存修改</Text>
          )}
        </Pressable>

        {/* 更新真实余额（仅资产/负债科目显示） */}
        {isBalanceAccount && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              对账
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  输入该科目的真实余额（如银行余额）
                </Text>
                <View style={styles.snapshotRow}>
                  <TextInput
                    style={[styles.input, styles.snapshotInput, { color: colors.text, borderColor: colors.border }]}
                    value={realBalance}
                    onChangeText={setRealBalance}
                    keyboardType="decimal-pad"
                    placeholder="真实余额"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Pressable
                    style={[
                      styles.snapshotBtn,
                      { backgroundColor: realBalance.trim() ? Colors.primary : colors.border },
                    ]}
                    onPress={handleSnapshot}
                    disabled={!realBalance.trim() || snapshotLoading}
                  >
                    {snapshotLoading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.snapshotBtnText}>提交</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Children list */}
        {account.children.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              子科目（{account.children.length}）
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {account.children.map((child) => (
                <Pressable
                  key={child.id}
                  style={styles.childRow}
                  onPress={() => router.push(`/accounts/${child.id}` as any)}
                >
                  <FontAwesome
                    name={(child.icon as any) || 'circle-o'}
                    size={14}
                    color={Colors.primary}
                    style={{ width: 24 }}
                  />
                  <Text style={styles.childName}>{child.name}</Text>
                  <Text style={[styles.childCode, { color: colors.textSecondary }]}>
                    {child.code}
                  </Text>
                  <FontAwesome
                    name="chevron-right"
                    size={10}
                    color={colors.textSecondary}
                    style={{ opacity: 0.4 }}
                  />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  fieldRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  fieldLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    fontSize: 15,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  saveBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 8,
  },
  childName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  childCode: {
    fontSize: 12,
    marginRight: 4,
  },
  snapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  snapshotInput: {
    flex: 1,
  },
  snapshotBtn: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
