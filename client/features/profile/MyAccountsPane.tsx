import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAccountStore } from '@/stores/accountStore';
import {
  accountService,
  type AccountTreeNode,
  type AccountTreeResponse,
} from '@/services/accountService';
import { reportService, type AccountBalanceItem } from '@/services/reportService';
import {
  ACCOUNT_CATEGORIES,
  type AccountCategory,
  type AccountCategoryKey,
} from '@/constants/AccountCategoryMap';
import { styles as profileStyles } from '@/features/profile/styles';

/* ─── helpers ─── */

function findByCode(
  nodes: AccountTreeNode[],
  code: string,
): AccountTreeNode | null {
  for (const n of nodes) {
    if (n.code === code) return n;
    const found = findByCode(n.children, code);
    if (found) return found;
  }
  return null;
}

function getLeafAccounts(node: AccountTreeNode | null): AccountTreeNode[] {
  if (!node) return [];
  // 如果该节点本身是叶子，返回自身（不太可能发生在父节点上）
  if (node.is_leaf) return node.is_active ? [node] : [];
  const result: AccountTreeNode[] = [];
  for (const child of node.children) {
    if (child.is_leaf && child.is_active) {
      result.push(child);
    } else {
      result.push(...getLeafAccounts(child));
    }
  }
  return result;
}

type CategoryData = AccountCategory & {
  accounts: { node: AccountTreeNode; balance: number }[];
  subtotal: number;
  parentId: string | null;
};

/* ─── component ─── */

export default function MyAccountsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const currentBook = useBookStore((s) => s.currentBook);
  const { tree, fetchTree, isLoading: treeLoading } = useAccountStore();

  const [balanceMap, setBalanceMap] = useState<Record<string, number>>({});
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalCategory, setModalCategory] = useState<AccountCategoryKey | null>(null);
  const [accountName, setAccountName] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [creating, setCreating] = useState(false);

  // 折叠状态
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const bookId = currentBook?.id;

  // 加载数据
  const loadData = useCallback(async () => {
    if (!bookId) return;
    await fetchTree(bookId);
    setBalanceLoading(true);
    try {
      const { data } = await reportService.getBalanceSheet(bookId);
      const map: Record<string, number> = {};
      const flatten = (items: AccountBalanceItem[]) => {
        for (const item of items) {
          map[item.account_id] = item.balance;
        }
      };
      flatten(data.assets);
      flatten(data.liabilities);
      setBalanceMap(map);
    } catch {
      // ignore
    } finally {
      setBalanceLoading(false);
    }
  }, [bookId, fetchTree]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 构建分类数据
  const categoryData: CategoryData[] = useMemo(() => {
    if (!tree) return [];
    return ACCOUNT_CATEGORIES.map((cat) => {
      const rootNodes: AccountTreeNode[] =
        cat.accountType === 'liability' ? tree.liability : tree.asset;
      const parentNode = findByCode(rootNodes, cat.parentCode);
      const leafNodes = getLeafAccounts(parentNode);
      const accounts = leafNodes.map((node) => ({
        node,
        balance: balanceMap[node.id] ?? 0,
      }));
      const subtotal = accounts.reduce((sum, a) => sum + a.balance, 0);
      return { ...cat, accounts, subtotal, parentId: parentNode?.id ?? null };
    });
  }, [tree, balanceMap]);

  // 是否全部为空（判断空状态）
  const allEmpty = categoryData.every((c) => c.accounts.length === 0);

  // 打开 Modal
  const openModal = (catKey: AccountCategoryKey | null) => {
    setModalCategory(catKey ?? ACCOUNT_CATEGORIES[0].key);
    setAccountName('');
    setInitialBalance('');
    setModalVisible(true);
  };

  // 提交创建
  const handleCreate = async () => {
    if (!bookId || !modalCategory || !accountName.trim()) return;
    const cat = ACCOUNT_CATEGORIES.find((c) => c.key === modalCategory);
    if (!cat || !tree) return;

    const rootNodes: AccountTreeNode[] =
      cat.accountType === 'liability' ? tree.liability : tree.asset;
    const parentNode = findByCode(rootNodes, cat.parentCode);
    if (!parentNode) {
      showToast('未找到对应的父科目，请检查科目表');
      return;
    }

    setCreating(true);
    try {
      await accountService.createAccount(bookId, {
        name: accountName.trim(),
        type: cat.accountType,
        balance_direction: cat.balanceDirection,
        parent_id: parentNode.id,
        icon: cat.icon,
      });
      setModalVisible(false);
      showToast('账户添加成功');
      await loadData();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 格式化金额
  const fmt = (val: number) => {
    const abs = Math.abs(val);
    const str = abs.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return val < 0 ? `-¥${str}` : `¥${str}`;
  };

  const balanceColor = (cat: AccountCategory, val: number) => {
    if (val === 0) return colors.textSecondary;
    return cat.accountType === 'liability' ? Colors.liability : Colors.asset;
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isLoading = treeLoading || balanceLoading;

  if (!bookId) {
    return (
      <View style={s.center}>
        <Text style={{ color: colors.textSecondary }}>请先选择账本</Text>
      </View>
    );
  }

  if (isLoading && !tree) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const selectedCat = ACCOUNT_CATEGORIES.find((c) => c.key === modalCategory);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[profileStyles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[profileStyles.detailTitle, { color: colors.text, marginBottom: 0 }]}>我的账户</Text>
        <Pressable
          style={[profileStyles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]}
          onPress={() => openModal(null)}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={profileStyles.saveBtnText}>添加账户</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        {allEmpty ? (
          /* 空状态 */
          <View style={s.emptyWrap}>
            <FontAwesome
              name="dollar"
              size={48}
              color={colors.textSecondary}
              style={{ opacity: 0.5 }}
            />
            <Text style={[s.emptyTitle, { color: colors.textSecondary }]}>
              还没有添加任何账户
            </Text>
            <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>
              点击下方按钮开始管理你的资金
            </Text>
            <Pressable
              style={[s.emptyBtn, { backgroundColor: Colors.primary }]}
              onPress={() => openModal(null)}
            >
              <Text style={s.emptyBtnText}>+ 添加账户</Text>
            </Pressable>
          </View>
        ) : (
          /* 分类列表 */
          categoryData.map((cat) => (
            <View key={cat.key} style={s.categoryWrap}>
              {/* 分类标题 */}
              <Pressable
                style={s.categoryHeader}
                onPress={() => toggleCollapse(cat.key)}
              >
                <FontAwesome
                  name={cat.icon as any}
                  size={18}
                  color={Colors.primary}
                  style={s.categoryIcon}
                />
                <Text style={[s.categoryLabel, { color: colors.text }]}>
                  {cat.label}
                </Text>
                <Text
                  style={[
                    s.categorySubtotal,
                    { color: balanceColor(cat, cat.subtotal) },
                  ]}
                >
                  {fmt(cat.subtotal)}
                </Text>
                <FontAwesome
                  name={collapsed[cat.key] ? 'caret-right' : 'caret-down'}
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginLeft: 8 }}
                />
              </Pressable>

              {/* 账户列表 */}
              {!collapsed[cat.key] && (
                <View
                  style={[s.accountList, { backgroundColor: colors.card }]}
                >
                  {cat.accounts.map((a) => (
                    <View
                      key={a.node.id}
                      style={[
                        s.accountRow,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <Text style={[s.accountName, { color: colors.text }]}>
                        {a.node.name}
                      </Text>
                      <Text
                        style={[
                          s.accountBalance,
                          { color: balanceColor(cat, a.balance) },
                        ]}
                      >
                        {fmt(a.balance)}
                      </Text>
                    </View>
                  ))}

                  {/* 分类内添加 */}
                  <Pressable
                    style={s.addInCategory}
                    onPress={() => openModal(cat.key)}
                  >
                    <Text style={[s.addInCategoryText, { color: Colors.primary }]}>
                      + {cat.addLabel}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* 添加账户 Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={ms.overlay} onPress={() => setModalVisible(false)}>
          <Pressable
            style={[ms.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[ms.title, { color: colors.text }]}>
              {selectedCat ? selectedCat.addLabel : '添加账户'}
            </Text>

            {/* 分类选择器（全局+入口时显示） */}
            <View style={ms.catRow}>
              {ACCOUNT_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.key}
                  style={[
                    ms.catItem,
                    {
                      backgroundColor:
                        modalCategory === cat.key
                          ? Colors.primary + '18'
                          : colors.background,
                      borderColor:
                        modalCategory === cat.key
                          ? Colors.primary
                          : colors.border,
                    },
                  ]}
                  onPress={() => setModalCategory(cat.key)}
                >
                  <FontAwesome
                    name={cat.icon as any}
                    size={20}
                    color={
                      modalCategory === cat.key
                        ? Colors.primary
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      ms.catItemLabel,
                      {
                        color:
                          modalCategory === cat.key
                            ? Colors.primary
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 账户名称 */}
            <Text style={[ms.fieldLabel, { color: colors.textSecondary }]}>
              账户名称
            </Text>
            <TextInput
              style={[
                ms.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              placeholder={
                selectedCat
                  ? `例如：${selectedCat.key === 'bank' ? '招商银行储蓄卡' : selectedCat.key === 'credit-card' ? '招商银行信用卡' : '中信证券'}`
                  : '请输入账户名称'
              }
              placeholderTextColor={colors.textSecondary}
              value={accountName}
              onChangeText={setAccountName}
              autoFocus
            />

            {/* 初始余额 */}
            <Text style={[ms.fieldLabel, { color: colors.textSecondary }]}>
              初始余额（可选）
            </Text>
            <TextInput
              style={[
                ms.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              value={initialBalance}
              onChangeText={setInitialBalance}
              keyboardType="decimal-pad"
            />

            {/* 按钮 */}
            <View style={ms.btnRow}>
              <Pressable
                style={[ms.btn, { backgroundColor: colors.border }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                style={[
                  ms.btn,
                  {
                    backgroundColor: accountName.trim()
                      ? Colors.primary
                      : Colors.primary + '60',
                  },
                ]}
                onPress={handleCreate}
                disabled={!accountName.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>添加</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View style={[s.toast, { backgroundColor: colors.text + 'DD' }]}>
          <Text style={{ color: colors.background, fontSize: 14 }}>
            {toastMsg}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ─── styles ─── */

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // 空状态
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyDesc: { fontSize: 14 },
  emptyBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  emptyBtnText: { color: '#FFF', fontWeight: '600', fontSize: 15 },

  // 分类
  categoryWrap: { marginBottom: 20 },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  categoryIcon: { width: 28, textAlign: 'center' },
  categoryLabel: { fontSize: 16, fontWeight: '600', marginLeft: 8, flex: 1 },
  categorySubtotal: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // 账户列表
  accountList: { borderRadius: 10, overflow: 'hidden', marginTop: 4 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accountName: { fontSize: 15 },
  accountBalance: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },

  // 分类内添加
  addInCategory: { paddingHorizontal: 16, height: 40, justifyContent: 'center' },
  addInCategoryText: { fontSize: 14 },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
});

const ms = StyleSheet.create({
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
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  catItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
  },
  catItemLabel: { fontSize: 12, fontWeight: '500' },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 16,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
