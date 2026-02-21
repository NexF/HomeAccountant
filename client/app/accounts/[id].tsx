import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAccountStore, ACCOUNT_TYPE_LABELS, type AccountType } from '@/stores/accountStore';
import { accountService, type AccountTreeNode, type CreateAccountParams } from '@/services/accountService';
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

  const [realBalance, setRealBalance] = useState('');
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const showToast = (title: string, message: string, duration = 3000) => {
    setToastMsg(`${title}: ${message}`);
    setTimeout(() => setToastMsg(''), duration);
  };

  // 新增子科目 Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIcon, setCreateIcon] = useState('');
  const [creating, setCreating] = useState(false);

  // 停用确认 Modal
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

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
      showToast('成功', '科目已更新');
    } catch {
      showToast('错误', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSnapshot = async () => {
    if (!account || !realBalance.trim()) return;
    const val = parseFloat(realBalance);
    if (isNaN(val)) {
      showToast('错误', '请输入有效金额');
      return;
    }
    setSnapshotLoading(true);
    try {
      const { data } = await syncService.submitSnapshot(account.id, val);
      setRealBalance('');
      if (data.status === 'balanced') {
        showToast('成功', '余额一致，无需调节');
      } else {
        const diffStr = Math.abs(data.difference).toFixed(2);
        showToast('已生成调节分录', `差异 ¥${diffStr}，已生成待分类调节分录`);
      }
    } catch {
      showToast('错误', '提交失败');
    } finally {
      setSnapshotLoading(false);
    }
  };

  const handleAddChild = () => {
    if (!account) return;
    setCreateName('');
    setCreateIcon('');
    setShowCreateModal(true);
  };

  const handleCreateChild = async () => {
    if (!account || !currentBook || !createName.trim()) return;
    setCreating(true);
    try {
      const params: CreateAccountParams = {
        name: createName.trim(),
        type: account.type as CreateAccountParams['type'],
        balance_direction: account.balance_direction,
        parent_id: account.id,
        ...(createIcon.trim() ? { icon: createIcon.trim() } : {}),
      };
      const { data } = await accountService.createAccount(currentBook.id, params);
      setShowCreateModal(false);
      await fetchTree(currentBook.id);
      if (data.migration?.triggered) {
        showToast('分录已迁移', data.migration.message, 5000);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '创建失败';
      showToast('错误', msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = () => {
    if (!account) return;
    setShowDeactivateConfirm(true);
  };

  const confirmDeactivate = async () => {
    if (!account) return;
    try {
      await accountService.deactivateAccount(account.id);
      if (currentBook) await fetchTree(currentBook.id);
      setShowDeactivateConfirm(false);
      router.back();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '停用失败';
      showToast('错误', msg);
      setShowDeactivateConfirm(false);
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

        {/* 更新真实余额（仅叶子科目显示） */}
        {isBalanceAccount && account.children.length === 0 && (
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

        {/* 子科目 section — 始终显示 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 8 }]}>
            {account.children.length > 0
              ? `子科目（${account.children.length}）`
              : '新增子科目'}
          </Text>
          <Pressable
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
            onPress={handleAddChild}
          >
            <FontAwesome name="plus" size={13} color={Colors.primary} />
          </Pressable>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {account.children.length > 0 ? (
            account.children.map((child) => (
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
            ))
          ) : (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                点击右侧 ＋ 添加子科目
              </Text>
            </View>
          )}
        </View>

        {/* 停用科目按钮 — 仅非系统科目显示 */}
        {!account.is_system && (
          <Pressable
            style={styles.deactivateBtn}
            onPress={handleDeactivate}
          >
            <Text style={styles.deactivateBtnText}>停用科目</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* 新增子科目 Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <Pressable
          style={modalStyles.overlay}
          onPress={() => setShowCreateModal(false)}
        >
          <Pressable
            style={[modalStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[modalStyles.title, { color: colors.text }]}>新增子科目</Text>

            <View style={modalStyles.readonlyRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>父科目</Text>
              <View style={[modalStyles.readonlyBadge, { backgroundColor: Colors.primary + '15' }]}>
                <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>
                  {account.name}（{account.code}）
                </Text>
              </View>
            </View>

            <View style={modalStyles.readonlyRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>类型</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type}
              </Text>
            </View>

            <View style={modalStyles.readonlyRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>余额方向</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {account.balance_direction === 'debit' ? '借方' : '贷方'}
              </Text>
            </View>

            <View style={modalStyles.fieldRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>名称</Text>
              <TextInput
                style={[modalStyles.input, { color: colors.text, borderColor: colors.border }]}
                value={createName}
                onChangeText={setCreateName}
                placeholder="科目名称"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>

            <View style={modalStyles.fieldRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>图标（可选）</Text>
              <TextInput
                style={[modalStyles.input, { color: colors.text, borderColor: colors.border }]}
                value={createIcon}
                onChangeText={setCreateIcon}
                placeholder="FontAwesome 图标名"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={modalStyles.btnRow}>
              <Pressable
                style={[modalStyles.btn, { backgroundColor: colors.border }]}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[
                  modalStyles.btn,
                  {
                    backgroundColor:
                      createName.trim() ? Colors.primary : colors.border,
                  },
                ]}
                onPress={handleCreateChild}
                disabled={!createName.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 停用确认 Modal */}
      <Modal visible={showDeactivateConfirm} transparent animationType="fade">
        <Pressable style={modalStyles.overlay} onPress={() => setShowDeactivateConfirm(false)}>
          <Pressable
            style={[modalStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[modalStyles.title, { color: colors.text }]}>停用科目</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要停用「{account.name}」吗？
            </Text>
            <View style={modalStyles.btnRow}>
              <Pressable
                style={[modalStyles.btn, { backgroundColor: colors.border }]}
                onPress={() => setShowDeactivateConfirm(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[modalStyles.btn, { backgroundColor: '#EF4444' }]}
                onPress={confirmDeactivate}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>停用</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 24,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  readonlyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  readonlyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  fieldRow: {
    marginBottom: 12,
  },
  input: {
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

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
  deactivateBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    marginTop: 24,
    marginBottom: 40,
  },
  deactivateBtnText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
});
