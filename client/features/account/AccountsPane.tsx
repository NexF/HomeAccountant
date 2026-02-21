import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  useAccountStore,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  type AccountType,
} from '@/stores/accountStore';
import { accountService, type AccountTreeNode, type CreateAccountParams } from '@/services/accountService';
import { syncService } from '@/services/syncService';
import { styles, budgetStyles } from '@/features/profile/styles';

const TYPE_COLORS: Record<AccountType, string> = {
  asset: Colors.asset,
  liability: Colors.liability,
  equity: Colors.primary,
  income: '#F59E0B',
  expense: '#8B5CF6',
};

const DIRECTION_LABEL: Record<string, string> = {
  debit: '借',
  credit: '贷',
};

const DEFAULT_DIRECTION: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  expense: 'debit',
};

function AccountRow({
  node,
  depth,
  onPress,
  onAdd,
}: {
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onAdd: (node: AccountTreeNode) => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <Pressable
        style={[styles.acctRow, { paddingLeft: 16 + depth * 24 }]}
        onPress={() => onPress(node)}
      >
        {hasChildren ? (
          <Pressable onPress={() => setExpanded(!expanded)} style={styles.expandBtn}>
            <FontAwesome
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={10}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : (
          <View style={styles.expandBtn} />
        )}
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: TYPE_COLORS[node.type as AccountType] + '18' },
          ]}
        >
          <FontAwesome
            name={(node.icon as any) || 'circle'}
            size={14}
            color={TYPE_COLORS[node.type as AccountType]}
          />
        </View>
        <View style={styles.acctRowContent}>
          <Text style={styles.acctRowName}>{node.name}</Text>
          <Text style={[styles.acctRowCode, { color: colors.textSecondary }]}>{node.code}</Text>
        </View>
        <View
          style={[
            styles.directionBadge,
            {
              backgroundColor:
                node.balance_direction === 'debit' ? Colors.asset + '15' : Colors.liability + '15',
            },
          ]}
        >
          <Text
            style={[
              styles.directionText,
              {
                color: node.balance_direction === 'debit' ? Colors.asset : Colors.liability,
              },
            ]}
          >
            {DIRECTION_LABEL[node.balance_direction]}
          </Text>
        </View>
        <Pressable
          style={styles.deleteBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            onAdd(node);
          }}
        >
          <FontAwesome name="plus" size={13} color={Colors.primary} />
        </Pressable>
      </Pressable>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <AccountRow
            key={child.id}
            node={child}
            depth={depth + 1}
            onPress={onPress}
            onAdd={onAdd}
          />
        ))}
    </>
  );
}

function AccountDetailInline({
  accountId,
  onBack,
}: {
  accountId: string;
  onBack: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { tree, fetchTree } = useAccountStore();
  const { currentBook } = useBookStore();

  const [account, setAccount] = useState<AccountTreeNode | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const [realBalance, setRealBalance] = useState('');
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [childDetailId, setChildDetailId] = useState<string | null>(null);

  // 新增子科目 Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIcon, setCreateIcon] = useState('');
  const [creating, setCreating] = useState(false);

  // 停用确认 Modal
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  const showToast = (msg: string, duration = 3000) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), duration);
  };

  const findNodeById = (nodes: AccountTreeNode[], id: string): AccountTreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
    return null;
  };

  useEffect(() => {
    if (!tree || !accountId) return;
    const allNodes = [
      ...(tree.asset ?? []),
      ...(tree.liability ?? []),
      ...(tree.equity ?? []),
      ...(tree.income ?? []),
      ...(tree.expense ?? []),
    ];
    const found = findNodeById(allNodes, accountId);
    if (found) {
      setAccount(found);
      setName(found.name);
      setIcon(found.icon ?? '');
      setSortOrder(String(found.sort_order));
    }
  }, [tree, accountId]);

  const handleSave = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const params: Record<string, any> = {};
      if (name !== account.name) params.name = name;
      if (icon !== (account.icon ?? '')) params.icon = icon || null;
      if (Number(sortOrder) !== account.sort_order) params.sort_order = Number(sortOrder);
      if (Object.keys(params).length === 0) { setSaving(false); return; }
      await accountService.updateAccount(account.id, params);
      if (currentBook) await fetchTree(currentBook.id);
      setDirty(false);
      showToast('保存成功');
    } catch {
      showToast('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSnapshot = async () => {
    if (!account || !realBalance.trim()) return;
    const val = parseFloat(realBalance);
    if (isNaN(val)) { showToast('请输入有效金额'); return; }
    setSnapshotLoading(true);
    try {
      const { data } = await syncService.submitSnapshot(account.id, val);
      setRealBalance('');
      if (data.status === 'balanced') {
        showToast('余额一致，无需调节');
      } else {
        showToast(`差异 ¥${Math.abs(data.difference).toFixed(2)}，已生成待分类调节分录`);
      }
    } catch {
      showToast('提交失败');
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
        showToast(data.migration.message, 5000);
      }
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!account) return;
    try {
      await accountService.deactivateAccount(account.id);
      if (currentBook) await fetchTree(currentBook.id);
      setShowDeactivateConfirm(false);
      onBack();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '停用失败');
      setShowDeactivateConfirm(false);
    }
  };

  if (childDetailId) {
    return (
      <AccountDetailInline
        accountId={childDetailId}
        onBack={() => setChildDetailId(null)}
      />
    );
  }

  if (!account) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const isBalanceAccount = account.type === 'asset' || account.type === 'liability';

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>科目详情</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
          {([
            ['编码', account.code],
            ['类型', ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type],
            ['余额方向', account.balance_direction === 'debit' ? '借方' : '贷方'],
            ['来源', account.is_system ? '系统预置' : '用户自定义'],
          ] as [string, string][]).map(([label, value]) => (
            <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
              <Text style={[styles.formValue, { color: colors.text }]}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, paddingHorizontal: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {account.is_system ? '可编辑字段（系统科目仅可改名称/图标）' : '编辑科目'}
        </Text>
        <View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>名称</Text>
            <TextInput
              style={{ fontSize: 15, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
              value={name}
              onChangeText={(v) => { setName(v); setDirty(true); }}
              placeholder="科目名称"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>图标</Text>
            <TextInput
              style={{ fontSize: 15, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
              value={icon}
              onChangeText={(v) => { setIcon(v); setDirty(true); }}
              placeholder="FontAwesome 图标名"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>排序</Text>
            <TextInput
              style={{ fontSize: 15, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
              value={sortOrder}
              onChangeText={(v) => { setSortOrder(v); setDirty(true); }}
              keyboardType="numeric"
              placeholder="排序号"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        <Pressable
          style={[styles.saveBtn, { backgroundColor: dirty ? Colors.primary : colors.border, marginBottom: 24 }]}
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.saveBtnText}>保存修改</Text>}
        </Pressable>

        {isBalanceAccount && account.children.length === 0 && (
          <>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, paddingHorizontal: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              对账
            </Text>
            <View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>
                  输入该科目的真实余额（如银行余额）
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={{ flex: 1, fontSize: 15, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
                    value={realBalance}
                    onChangeText={setRealBalance}
                    keyboardType="decimal-pad"
                    placeholder="真实余额"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Pressable
                    style={{ height: 38, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: realBalance.trim() ? Colors.primary : colors.border }}
                    onPress={handleSnapshot}
                    disabled={!realBalance.trim() || snapshotLoading}
                  >
                    {snapshotLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>提交</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </>
        )}

        {/* 子科目 section — 始终显示 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
        <View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
          {account.children.length > 0 ? (
            account.children.map((child) => (
              <Pressable
                key={child.id}
                style={[styles.acctRow, { paddingLeft: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }]}
                onPress={() => setChildDetailId(child.id)}
              >
                <FontAwesome name={(child.icon as any) || 'circle-o'} size={14} color={Colors.primary} style={{ width: 24 }} />
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', marginLeft: 8 }}>{child.name}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginRight: 4 }}>{child.code}</Text>
                <FontAwesome name="chevron-right" size={10} color={colors.textSecondary} style={{ opacity: 0.4 }} />
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
            style={{
              height: 44,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#FEE2E2',
              marginTop: 24,
              marginBottom: 40,
            }}
            onPress={() => setShowDeactivateConfirm(true)}
          >
            <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '600' }}>停用科目</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* 新增子科目 Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowCreateModal(false)}>
          <Pressable
            style={[budgetStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[budgetStyles.title, { color: colors.text }]}>新增子科目</Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>父科目</Text>
              <View style={{ backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>
                  {account.name}（{account.code}）
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>类型</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>余额方向</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {account.balance_direction === 'debit' ? '借方' : '贷方'}
              </Text>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>名称</Text>
              <TextInput
                style={{ fontSize: 15, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
                value={createName}
                onChangeText={setCreateName}
                placeholder="科目名称"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>图标（可选）</Text>
              <TextInput
                style={{ fontSize: 15, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
                value={createIcon}
                onChangeText={setCreateIcon}
                placeholder="FontAwesome 图标名"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowCreateModal(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[budgetStyles.btn, { backgroundColor: createName.trim() ? Colors.primary : colors.border }]}
                onPress={handleCreateChild}
                disabled={!createName.trim() || creating}
              >
                {creating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 停用确认 Modal */}
      <Modal visible={showDeactivateConfirm} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowDeactivateConfirm(false)}>
          <Pressable
            style={[budgetStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[budgetStyles.title, { color: colors.text }]}>停用科目</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要停用「{account.name}」吗？
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowDeactivateConfirm(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={handleConfirmDeactivate}>
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

export default function AccountsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { currentBook, fetchBooks } = useBookStore();
  const { tree, isLoading, fetchTree } = useAccountStore();
  const [activeTab, setActiveTab] = useState<AccountType>('asset');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  // 新增科目 Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createParent, setCreateParent] = useState<AccountTreeNode | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDirection, setCreateDirection] = useState<'debit' | 'credit'>('debit');
  const [createIcon, setCreateIcon] = useState('');
  const [creating, setCreating] = useState(false);

  const showToast = (msg: string, duration = 3000) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), duration);
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  useEffect(() => {
    if (currentBook) {
      fetchTree(currentBook.id);
    }
  }, [currentBook?.id]);

  const handlePress = (node: AccountTreeNode) => {
    setSelectedAccountId(node.id);
  };

  const handleAdd = (node: AccountTreeNode) => {
    setCreateParent(node);
    setCreateName('');
    setCreateDirection(node.balance_direction);
    setCreateIcon('');
    setShowCreateModal(true);
  };

  const handleHeaderAdd = () => {
    setCreateParent(null);
    setCreateName('');
    setCreateDirection(DEFAULT_DIRECTION[activeTab]);
    setCreateIcon('');
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    if (!currentBook || !createName.trim()) return;
    setCreating(true);
    try {
      const params: CreateAccountParams = {
        name: createName.trim(),
        type: createParent ? (createParent.type as CreateAccountParams['type']) : activeTab,
        balance_direction: createParent ? createParent.balance_direction : createDirection,
        ...(createParent ? { parent_id: createParent.id } : {}),
        ...(createIcon.trim() ? { icon: createIcon.trim() } : {}),
      };

      const { data } = await accountService.createAccount(currentBook.id, params);
      setShowCreateModal(false);
      await fetchTree(currentBook.id);

      if (data.migration?.triggered) {
        showToast(data.migration.message, 5000);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '创建失败';
      showToast(msg);
    } finally {
      setCreating(false);
    }
  };

  const currentAccounts = tree ? tree[activeTab] : [];

  if (selectedAccountId) {
    return (
      <AccountDetailInline
        accountId={selectedAccountId}
        onBack={() => setSelectedAccountId(null)}
      />
    );
  }

  if (isLoading && !tree) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>科目管理</Text>
        <Pressable
          onPress={handleHeaderAdd}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <FontAwesome name="plus" size={18} color={Colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.acctTabBar}
        contentContainerStyle={styles.acctTabContent}
      >
        {ACCOUNT_TYPE_ORDER.map((type) => {
          const active = activeTab === type;
          return (
            <Pressable
              key={type}
              style={[
                styles.acctTab,
                active && { backgroundColor: TYPE_COLORS[type] + '18', borderColor: TYPE_COLORS[type] },
              ]}
              onPress={() => setActiveTab(type)}
            >
              <Text
                style={[
                  styles.acctTabText,
                  { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                  active && { fontWeight: '600' },
                ]}
              >
                {ACCOUNT_TYPE_LABELS[type]}
              </Text>
              {tree && (
                <Text
                  style={[
                    styles.acctTabCount,
                    { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                  ]}
                >
                  {tree[type].length}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.acctList}>
        {currentAccounts.length === 0 ? (
          <View style={styles.acctEmpty}>
            <FontAwesome name="folder-open-o" size={40} color={colors.textSecondary} />
            <Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>
              暂无{ACCOUNT_TYPE_LABELS[activeTab]}类科目
            </Text>
          </View>
        ) : (
          currentAccounts.map((node) => (
            <AccountRow
              key={node.id}
              node={node}
              depth={0}
              onPress={handlePress}
              onAdd={handleAdd}
            />
          ))
        )}
      </ScrollView>

      {/* 新增科目 Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowCreateModal(false)}>
          <Pressable
            style={[budgetStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[budgetStyles.title, { color: colors.text }]}>
              {createParent ? '新增子科目' : '新增科目'}
            </Text>

            {createParent && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>父科目</Text>
                <View style={{ backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                  <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>
                    {createParent.name}（{createParent.code}）
                  </Text>
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>类型</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {ACCOUNT_TYPE_LABELS[
                  createParent ? (createParent.type as AccountType) : activeTab
                ]}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>余额方向</Text>
              {createParent ? (
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                  {createParent.balance_direction === 'debit' ? '借方' : '贷方'}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['debit', 'credit'] as const).map((dir) => (
                    <Pressable
                      key={dir}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 5,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: createDirection === dir ? Colors.primary : 'transparent',
                        backgroundColor: createDirection === dir ? Colors.primary + '20' : 'transparent',
                      }}
                      onPress={() => setCreateDirection(dir)}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '500', color: createDirection === dir ? Colors.primary : colors.textSecondary }}>
                        {dir === 'debit' ? '借方' : '贷方'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>名称</Text>
              <TextInput
                style={{ fontSize: 15, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
                value={createName}
                onChangeText={setCreateName}
                placeholder="科目名称"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>图标（可选）</Text>
              <TextInput
                style={{ fontSize: 15, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, color: colors.text, borderColor: colors.border }}
                value={createIcon}
                onChangeText={setCreateIcon}
                placeholder="FontAwesome 图标名"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowCreateModal(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[budgetStyles.btn, { backgroundColor: createName.trim() ? Colors.primary : colors.border }]}
                onPress={handleCreate}
                disabled={!createName.trim() || creating}
              >
                {creating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>}
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
