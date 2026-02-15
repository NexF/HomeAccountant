import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
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
import type { AccountTreeNode, CreateAccountParams } from '@/services/accountService';
import { accountService } from '@/services/accountService';

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
        style={[styles.row, { paddingLeft: 16 + depth * 24 }]}
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
        <View style={styles.rowContent}>
          <Text style={styles.rowName}>{node.name}</Text>
          <Text style={[styles.rowCode, { color: colors.textSecondary }]}>{node.code}</Text>
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
                color:
                  node.balance_direction === 'debit' ? Colors.asset : Colors.liability,
              },
            ]}
          >
            {DIRECTION_LABEL[node.balance_direction]}
          </Text>
        </View>
        <Pressable
          style={styles.addBtn}
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

export default function AccountsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook, fetchBooks } = useBookStore();
  const { tree, isLoading, fetchTree } = useAccountStore();
  const [activeTab, setActiveTab] = useState<AccountType>('asset');

  const [toastMsg, setToastMsg] = useState('');
  const showToast = (title: string, message: string, duration = 3000) => {
    setToastMsg(`${title}: ${message}`);
    setTimeout(() => setToastMsg(''), duration);
  };

  // Modal 控制
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createParent, setCreateParent] = useState<AccountTreeNode | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDirection, setCreateDirection] = useState<'debit' | 'credit'>('debit');
  const [createIcon, setCreateIcon] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchBooks();
  }, []);

  useEffect(() => {
    if (currentBook) {
      fetchTree(currentBook.id);
    }
  }, [currentBook?.id]);

  const handlePress = (node: AccountTreeNode) => {
    router.push(`/accounts/${node.id}` as any);
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
        showToast('分录已迁移', data.migration.message, 5000);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '创建失败';
      showToast('错误', msg);
    } finally {
      setCreating(false);
    }
  };

  const currentAccounts = tree ? tree[activeTab] : [];

  if (isLoading && !tree) {
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
        <Text style={styles.title}>科目管理</Text>
        <Pressable onPress={handleHeaderAdd} style={styles.backBtn}>
          <FontAwesome name="plus" size={18} color={Colors.primary} />
        </Pressable>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabContent}
      >
        {ACCOUNT_TYPE_ORDER.map((type) => {
          const active = activeTab === type;
          return (
            <Pressable
              key={type}
              style={[
                styles.tab,
                active && { backgroundColor: TYPE_COLORS[type] + '18', borderColor: TYPE_COLORS[type] },
              ]}
              onPress={() => setActiveTab(type)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                  active && { fontWeight: '600' },
                ]}
              >
                {ACCOUNT_TYPE_LABELS[type]}
              </Text>
              {tree && (
                <Text
                  style={[
                    styles.tabCount,
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

      {/* Account List */}
      <ScrollView style={styles.list}>
        {currentAccounts.length === 0 ? (
          <View style={styles.empty}>
            <FontAwesome name="folder-open-o" size={40} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
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
      <Modal visible={showCreateModal} transparent animationType="slide">
        <Pressable
          style={modalStyles.overlay}
          onPress={() => setShowCreateModal(false)}
        >
          <Pressable
            style={[modalStyles.content, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[modalStyles.title, { color: colors.text }]}>
              {createParent ? '新增子科目' : '新增科目'}
            </Text>

            {createParent && (
              <View style={modalStyles.readonlyRow}>
                <Text style={[modalStyles.label, { color: colors.textSecondary }]}>父科目</Text>
                <View style={[modalStyles.readonlyBadge, { backgroundColor: Colors.primary + '15' }]}>
                  <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>
                    {createParent.name}（{createParent.code}）
                  </Text>
                </View>
              </View>
            )}

            <View style={modalStyles.readonlyRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>类型</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                {ACCOUNT_TYPE_LABELS[
                  createParent ? (createParent.type as AccountType) : activeTab
                ]}
              </Text>
            </View>

            <View style={modalStyles.readonlyRow}>
              <Text style={[modalStyles.label, { color: colors.textSecondary }]}>余额方向</Text>
              {createParent ? (
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                  {createParent.balance_direction === 'debit' ? '借方' : '贷方'}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['debit', 'credit'] as const).map((dir) => (
                    <Pressable
                      key={dir}
                      style={[
                        modalStyles.chip,
                        createDirection === dir && {
                          backgroundColor: Colors.primary + '20',
                          borderColor: Colors.primary,
                        },
                      ]}
                      onPress={() => setCreateDirection(dir)}
                    >
                      <Text
                        style={[
                          modalStyles.chipText,
                          { color: createDirection === dir ? Colors.primary : colors.textSecondary },
                        ]}
                      >
                        {dir === 'debit' ? '借方' : '贷方'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
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
                onPress={handleCreate}
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
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
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
  tabBar: {
    flexGrow: 0,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  tabContent: {
    gap: 8,
    paddingRight: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  tabText: {
    fontSize: 14,
  },
  tabCount: {
    fontSize: 12,
    opacity: 0.7,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  expandBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rowContent: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowCode: {
    fontSize: 12,
    marginTop: 1,
  },
  directionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  directionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  addBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
});
