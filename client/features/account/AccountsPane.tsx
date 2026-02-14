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
import { accountService, type AccountTreeNode } from '@/services/accountService';
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

function AccountRow({
  node,
  depth,
  onPress,
  onDeactivate,
}: {
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onDeactivate: (node: AccountTreeNode) => void;
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
        {!node.is_system && (
          <Pressable
            style={styles.deleteBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              onDeactivate(node);
            }}
          >
            <FontAwesome name="trash-o" size={14} color={colors.textSecondary} />
          </Pressable>
        )}
      </Pressable>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <AccountRow
            key={child.id}
            node={child}
            depth={depth + 1}
            onPress={onPress}
            onDeactivate={onDeactivate}
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

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
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

        {isBalanceAccount && (
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

        {account.children.length > 0 && (
          <>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, paddingHorizontal: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              子科目（{account.children.length}）
            </Text>
            <View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
              {account.children.map((child) => (
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
              ))}
            </View>
          </>
        )}
      </ScrollView>

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
  const [deleteTarget, setDeleteTarget] = useState<AccountTreeNode | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
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

  const handleDeactivate = async (node: AccountTreeNode) => {
    setDeleteTarget(node);
  };

  const confirmDeactivate = async () => {
    if (!deleteTarget) return;
    try {
      await accountService.deactivateAccount(deleteTarget.id);
      if (currentBook) fetchTree(currentBook.id);
      setDeleteTarget(null);
      showToast('科目已停用');
    } catch {
      showToast('停用失败');
      setDeleteTarget(null);
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
      <View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>科目管理</Text>
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
              onDeactivate={handleDeactivate}
            />
          ))
        )}
      </ScrollView>

      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>停用科目</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要停用「{deleteTarget?.name}」吗？
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setDeleteTarget(null)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={confirmDeactivate}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>停用</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}
