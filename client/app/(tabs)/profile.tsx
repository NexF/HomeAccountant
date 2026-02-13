import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  ScrollView,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Modal,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthStore } from '@/stores/authStore';
import { useProfileNavStore } from '@/stores/profileNavStore';
import { authService } from '@/services/authService';
import { useBookStore } from '@/stores/bookStore';
import {
  useAccountStore,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  type AccountType,
} from '@/stores/accountStore';
import { accountService, type AccountTreeNode } from '@/services/accountService';
import { syncService } from '@/services/syncService';
import { useAssetStore } from '@/stores/assetStore';
import { useLoanStore } from '@/stores/loanStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { budgetService, type BudgetResponse } from '@/services/budgetService';
import { loanService, type LoanResponse, type RepaymentScheduleItem } from '@/services/loanService';
import BudgetCard from '@/components/budget/BudgetCard';
import RepaymentSchedule from '@/components/loans/RepaymentSchedule';
import AccountPicker from '@/components/entry/AccountPicker';
import AssetCard from '@/components/assets/AssetCard';
import DepreciationChart from '@/components/assets/DepreciationChart';
import { assetService, type AssetResponse, type DepreciationRecord } from '@/services/assetService';

// ─── Menu Item ───────────────────────────────────────────────

type MenuItemProps = {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  label: string;
  hint?: string;
  color?: string;
  onPress?: () => void;
};

function MenuItem({ icon, label, hint, color, onPress }: MenuItemProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <FontAwesome name={icon} size={18} color={color ?? Colors.primary} style={styles.menuIcon} />
      <Text style={styles.menuLabel}>{label}</Text>
      {hint ? (
        <Text style={[styles.menuHint, { color: colors.textSecondary }]}>{hint}</Text>
      ) : null}
      <FontAwesome name="chevron-right" size={12} color={colors.text} style={{ opacity: 0.3 }} />
    </Pressable>
  );
}

// ─── Detail Panes (desktop only) ────────────────────────────

type DetailPane = 'none' | 'edit-profile' | 'settings' | 'accounts' | 'assets' | 'loans' | 'budget';

function EditProfilePane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await authService.updateProfile({ nickname: nickname || null });
      useAuthStore.setState({ user: data });
      if (Platform.OS === 'web') window.alert('保存成功');
      else Alert.alert('成功', '个人信息已更新');
    } catch {
      if (Platform.OS === 'web') window.alert('保存失败');
      else Alert.alert('错误', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>编辑个人信息</Text>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>邮箱</Text>
          <Text style={[styles.formValue, { color: colors.textSecondary }]}>{user?.email}</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>昵称</Text>
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
            value={nickname}
            onChangeText={setNickname}
            placeholder="输入昵称"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>货币</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>{user?.currency ?? 'CNY'}</Text>
        </View>
      </View>
      <Pressable
        style={[styles.saveBtn, { backgroundColor: Colors.primary }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Text style={styles.saveBtnText}>保存</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function SettingsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <Text style={[styles.detailTitle, { color: colors.text }]}>设置</Text>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>深色模式</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>跟随系统</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>货币显示</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>¥ (CNY)</Text>
        </View>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>通知</Text>
          <Text style={[styles.formValue, { color: colors.textSecondary }]}>即将推出</Text>
        </View>
      </View>
      <View style={[styles.formCard, { backgroundColor: colors.card }]}>
        <View style={styles.formRow}>
          <Text style={[styles.formLabel, { color: colors.textSecondary }]}>版本</Text>
          <Text style={[styles.formValue, { color: colors.text }]}>0.1.0</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Accounts Pane (desktop embed) ──────────────────────────

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

  // 允许在面板内查看子科目详情
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

  // 递归查看子科目详情
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
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>科目详情</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Info Card */}
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

        {/* Editable fields */}
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

        {/* Save */}
        <Pressable
          style={[styles.saveBtn, { backgroundColor: dirty ? Colors.primary : colors.border, marginBottom: 24 }]}
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.saveBtnText}>保存修改</Text>}
        </Pressable>

        {/* 对账 */}
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

        {/* 子科目列表 */}
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

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AccountsPane() {
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

  // 展示科目详情
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

      {/* Tabs */}
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

      {/* Account List */}
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

      {/* 停用确认 Modal */}
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

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Assets Pane (desktop only) ─────────────────────────────

const ASSET_STATUS_TABS = [
  { key: null, label: '全部' },
  { key: 'active', label: '使用中' },
  { key: 'disposed', label: '已处置' },
] as const;

const ASSET_METHOD_LABEL: Record<string, string> = {
  straight_line: '直线法',
  none: '不折旧',
};

const ASSET_GRANULARITY_LABEL: Record<string, string> = {
  monthly: '按月',
  daily: '按日',
};

function AssetDetailInline({
  assetId,
  onBack,
  onDeleted,
}: {
  assetId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const currentBook = useBookStore((s) => s.currentBook);

  const [asset, setAsset] = useState<AssetResponse | null>(null);
  const [history, setHistory] = useState<DepreciationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [depreciating, setDepreciating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 处置相关
  const [showDispose, setShowDispose] = useState(false);
  const [disposalIncome, setDisposalIncome] = useState('');
  const [disposalDate, setDisposalDate] = useState('');
  const [incomeAccount, setIncomeAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [disposing, setDisposing] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchData = React.useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    try {
      const [assetRes, historyRes] = await Promise.all([
        assetService.getAsset(assetId),
        assetService.getDepreciationHistory(assetId),
      ]);
      setAsset(assetRes.data);
      setHistory(historyRes.data);
    } catch {
      showToast('加载资产信息失败');
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDepreciate = async () => {
    if (!asset) return;
    setDepreciating(true);
    try {
      const { data } = await assetService.depreciate(asset.id);
      setAsset(data.asset);
      const historyRes = await assetService.getDepreciationHistory(asset.id);
      setHistory(historyRes.data);
      showToast(data.message);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '折旧失败');
    } finally {
      setDepreciating(false);
    }
  };

  const handleDispose = async () => {
    if (!asset || !incomeAccount) return;
    setDisposing(true);
    try {
      const { data } = await assetService.dispose(asset.id, {
        disposal_income: parseFloat(disposalIncome || '0'),
        disposal_date: disposalDate || new Date().toISOString().slice(0, 10),
        income_account_id: incomeAccount.id,
      });
      setAsset(data.asset);
      setShowDispose(false);
      showToast(data.message);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '处置失败');
    } finally {
      setDisposing(false);
    }
  };

  const confirmDelete = async () => {
    if (!asset) return;
    setShowDeleteConfirm(false);
    try {
      await assetService.deleteAsset(asset.id);
      onDeleted();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '删除失败');
    }
  };

  if (loading) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={styles.acctCenter}>
        <Text>资产不存在</Text>
      </View>
    );
  }

  const isActive = asset.status === 'active';
  const canDepreciate = isActive && asset.depreciation_method !== 'none' && asset.depreciation_percentage < 100;

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{asset.name}</Text>
        <Pressable onPress={() => setShowDeleteConfirm(true)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="trash-o" size={18} color={Colors.asset} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* 基本信息 */}
        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
          {([
            ['资产名称', asset.name],
            ['关联科目', asset.account_name],
            ['购入日期', asset.purchase_date],
            ['原值', `¥ ${asset.original_cost.toLocaleString()}`],
            ['残值率', `${asset.residual_rate}%`],
            ['使用寿命', `${asset.useful_life_months} 个月`],
            ['折旧方式', ASSET_METHOD_LABEL[asset.depreciation_method] ?? asset.depreciation_method],
            ['折旧粒度', ASSET_GRANULARITY_LABEL[asset.depreciation_granularity]],
            ['状态', isActive ? '使用中' : '已处置', isActive ? Colors.primary : colors.textSecondary],
          ] as [string, string, string?][]).map(([label, value, valueColor]) => (
            <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
              <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
            </View>
          ))}
        </View>

        {/* 折旧信息 */}
        {asset.depreciation_method !== 'none' && (
          <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
            {([
              ['累计折旧', `¥ ${asset.accumulated_depreciation.toLocaleString()}`, Colors.asset],
              ['账面净值', `¥ ${asset.net_book_value.toLocaleString()}`, Colors.primary],
              [asset.depreciation_granularity === 'daily' ? '日折旧额' : '月折旧额', `¥ ${asset.period_depreciation.toFixed(2)}`],
              ['折旧进度', `${asset.depreciation_percentage}%`],
              ['剩余月数', `${asset.remaining_months} 个月`],
            ] as [string, string, string?][]).map(([label, value, valueColor]) => (
              <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
                <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
              </View>
            ))}

            {/* 进度条 */}
            <View style={{ padding: 16, paddingTop: 8 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
                <View style={{
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: asset.depreciation_percentage >= 100 ? Colors.liability : Colors.primary,
                  width: `${Math.min(asset.depreciation_percentage, 100)}%`,
                }} />
              </View>
            </View>
          </View>
        )}

        {/* 折旧历史 */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <DepreciationChart records={history} originalCost={asset.original_cost} />
        </View>

        {/* 操作按钮 */}
        {isActive && (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 16 }}>
            {canDepreciate && (
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary, opacity: depreciating ? 0.6 : 1 }}
                onPress={handleDepreciate}
                disabled={depreciating}
              >
                {depreciating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <FontAwesome name="calculator" size={14} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>计提折旧</Text>
                  </>
                )}
              </Pressable>
            )}

            <Pressable
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.asset }}
              onPress={() => {
                setDisposalDate(new Date().toISOString().slice(0, 10));
                setShowDispose(!showDispose);
              }}
            >
              <FontAwesome name="trash" size={14} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>处置资产</Text>
            </Pressable>
          </View>
        )}

        {/* 处置表单 */}
        {showDispose && (
          <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 12 }}>处置资产</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>处置收入</Text>
              <TextInput
                style={{ flex: 1, fontSize: 14, textAlign: 'right', paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderRadius: 6, color: colors.text, borderColor: colors.border }}
                value={disposalIncome}
                onChangeText={setDisposalIncome}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>处置日期</Text>
              <TextInput
                style={{ flex: 1, fontSize: 14, textAlign: 'right', paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderRadius: 6, color: colors.text, borderColor: colors.border }}
                value={disposalDate}
                onChangeText={setDisposalDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}
              onPress={() => setPickerVisible(true)}
            >
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>收款账户</Text>
              <Text style={{ color: incomeAccount ? colors.text : colors.textSecondary, flex: 1, textAlign: 'right' }}>
                {incomeAccount ? incomeAccount.name : '请选择'}
              </Text>
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} style={{ marginLeft: 8 }} />
            </Pressable>

            <Pressable
              style={{ paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: Colors.asset, opacity: disposing || !incomeAccount ? 0.6 : 1 }}
              onPress={handleDispose}
              disabled={disposing || !incomeAccount}
            >
              {disposing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>确认处置</Text>
              )}
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <AccountPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(account) => {
          setIncomeAccount(account);
          setPickerVisible(false);
        }}
        allowedTypes={['asset'] as AccountType[]}
        selectedId={incomeAccount?.id}
        bookId={currentBook?.id}
      />

      {/* 删除确认 */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除资产</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{asset.name}」吗？此操作不可撤销。
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={confirmDelete}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: '#323232', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AssetsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { assets, summary, isLoading, filterStatus, fetchAssets, fetchSummary, setFilterStatus } =
    useAssetStore();

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (currentBook) {
      fetchAssets(currentBook.id);
      fetchSummary(currentBook.id);
    }
  }, [currentBook?.id, filterStatus]);

  const handleAssetPress = (asset: AssetResponse) => {
    setSelectedAssetId(asset.id);
  };

  const handleStatusChange = (status: string | null) => {
    setFilterStatus(status);
  };

  const handleBackFromDetail = () => {
    setSelectedAssetId(null);
  };

  const handleAssetDeleted = () => {
    setSelectedAssetId(null);
    if (currentBook) {
      fetchAssets(currentBook.id);
      fetchSummary(currentBook.id);
    }
  };

  // 展示资产详情
  if (selectedAssetId) {
    return (
      <AssetDetailInline
        assetId={selectedAssetId}
        onBack={handleBackFromDetail}
        onDeleted={handleAssetDeleted}
      />
    );
  }

  if (isLoading && assets.length === 0) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>固定资产</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]}
          onPress={() => router.push('/assets/new' as any)}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.saveBtnText}>添加资产</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {/* Summary Card */}
        {summary && (
          <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>资产总原值</Text>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>¥{summary.total_original_cost.toLocaleString()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>净值合计</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>¥{summary.total_net_book_value.toLocaleString()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>累计折旧</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.asset }}>¥{summary.total_accumulated_depreciation.toLocaleString()}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>
              共 {summary.asset_count} 项资产，{summary.active_count} 项使用中
            </Text>
          </View>
        )}

        {/* Status Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 12 }}
          contentContainerStyle={{ gap: 8, paddingRight: 12 }}
        >
          {ASSET_STATUS_TABS.map((tab) => {
            const active = filterStatus === tab.key;
            return (
              <Pressable
                key={tab.key ?? 'all'}
                style={[
                  styles.acctTab,
                  active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                ]}
                onPress={() => handleStatusChange(tab.key)}
              >
                <Text
                  style={[
                    styles.acctTabText,
                    { color: active ? Colors.primary : colors.textSecondary },
                    active && { fontWeight: '600' },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Asset List */}
        {assets.length === 0 ? (
          <View style={styles.acctEmpty}>
            <FontAwesome name="building-o" size={40} color={colors.textSecondary} />
            <Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无固定资产</Text>
          </View>
        ) : (
          assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onPress={handleAssetPress} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Loans Pane (desktop only) ──────────────────────────────

const LOAN_STATUS_TABS = [
  { key: null, label: '全部' },
  { key: 'active', label: '还款中' },
  { key: 'paid_off', label: '已结清' },
] as const;

const LOAN_METHOD_LABEL: Record<string, string> = {
  equal_installment: '等额本息',
  equal_principal: '等额本金',
};

function LoanDetailInline({
  loanId,
  onBack,
  onDeleted,
}: {
  loanId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const currentBook = useBookStore((s) => s.currentBook);

  const [loan, setLoan] = useState<LoanResponse | null>(null);
  const [schedule, setSchedule] = useState<RepaymentScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [repaying, setRepaying] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [paymentAccount, setPaymentAccount] = useState<AccountTreeNode | null>(null);
  const [interestAccount, setInterestAccount] = useState<AccountTreeNode | null>(null);
  const [pickerMode, setPickerMode] = useState<'payment' | 'interest' | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const findAccountByCode = (nodes: AccountTreeNode[], code: string): AccountTreeNode | null => {
    for (const node of nodes) {
      if (node.code === code) return node;
      if (node.children?.length) {
        const found = findAccountByCode(node.children, code);
        if (found) return found;
      }
    }
    return null;
  };

  const fetchData = React.useCallback(async () => {
    if (!loanId || !currentBook) return;
    setLoading(true);
    try {
      const [loanRes, scheduleRes, treeRes] = await Promise.all([
        loanService.getLoan(loanId),
        loanService.getSchedule(loanId),
        accountService.getAccountTree(currentBook.id),
      ]);
      setLoan(loanRes.data);
      setSchedule(scheduleRes.data);
      if (!interestAccount) {
        const expenseNodes = treeRes.data.expense ?? [];
        const found = findAccountByCode(expenseNodes, '5013');
        if (found) setInterestAccount(found);
      }
    } catch {
      showToast('加载贷款信息失败');
    } finally {
      setLoading(false);
    }
  }, [loanId, currentBook]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRepay = async () => {
    if (!loan || !paymentAccount) return;
    setRepaying(true);
    try {
      const { data } = await loanService.repay(loan.id, {
        payment_account_id: paymentAccount.id,
        interest_account_id: interestAccount?.id,
      });
      showToast(data.status === 'paid_off' ? '贷款已结清！' : `还款成功，剩余本金 ¥${data.remaining_principal.toFixed(2)}`);
      await fetchData();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '还款失败');
    } finally {
      setRepaying(false);
    }
  };

  const confirmDelete = async () => {
    if (!loan) return;
    setShowDeleteConfirm(false);
    try {
      await loanService.deleteLoan(loan.id);
      onDeleted();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '删除失败');
    }
  };

  if (loading) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!loan) {
    return (
      <View style={styles.acctCenter}>
        <Text>贷款不存在</Text>
      </View>
    );
  }

  const isActive = loan.status === 'active';
  const progress = loan.principal > 0 ? Math.round(((loan.principal - loan.remaining_principal) / loan.principal) * 100) : 100;

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{loan.name}</Text>
        <Pressable onPress={() => setShowDeleteConfirm(true)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="trash-o" size={18} color={Colors.asset} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* 基本信息 */}
        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
          {([
            ['贷款名称', loan.name],
            ['关联科目', loan.account_name],
            ['贷款本金', `¥ ${loan.principal.toLocaleString()}`],
            ['剩余本金', `¥ ${loan.remaining_principal.toLocaleString()}`, Colors.primary],
            ['年利率', `${loan.annual_rate}%`],
            ['还款方式', LOAN_METHOD_LABEL[loan.repayment_method] ?? loan.repayment_method],
            ['月供', `¥ ${loan.monthly_payment.toFixed(2)}`],
            ['利息总额', `¥ ${loan.total_interest.toFixed(2)}`, Colors.asset],
            ['还款期数', `${loan.total_months} 个月`],
            ['已还期数', `${loan.repaid_months} 期`],
            ['首次还款', loan.start_date],
            ['状态', isActive ? '还款中' : '已结清', isActive ? Colors.liability : colors.textSecondary],
          ] as [string, string, string?][]).map(([label, value, valueColor]) => (
            <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
              <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
            </View>
          ))}
        </View>

        {/* 还款进度 */}
        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>还款进度 ({loan.repaid_months}/{loan.total_months}期)</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{progress}%</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
            <View style={{ height: '100%', borderRadius: 4, backgroundColor: progress >= 100 ? Colors.liability : Colors.primary, width: `${Math.min(progress, 100)}%` }} />
          </View>
        </View>

        {/* 还款操作 */}
        {isActive && (
          <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 12 }}>记录还款</Text>
            <Pressable style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 }} onPress={() => setPickerMode('payment')}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>还款账户</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: paymentAccount ? colors.text : colors.textSecondary, flex: 1 }}>{paymentAccount ? paymentAccount.name : '请选择资产账户'}</Text>
                <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
              </View>
            </Pressable>
            <Pressable style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 }} onPress={() => setPickerMode('interest')}>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>利息费用科目</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: interestAccount ? colors.text : colors.textSecondary, flex: 1 }}>{interestAccount ? interestAccount.name : '点击选择费用科目'}</Text>
                <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
              </View>
            </Pressable>
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, marginTop: 16, backgroundColor: Colors.primary, opacity: repaying || !paymentAccount ? 0.6 : 1 }}
              onPress={handleRepay}
              disabled={repaying || !paymentAccount}
            >
              {repaying ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <FontAwesome name="check" size={14} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>记录一期还款</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* 还款计划 */}
        <RepaymentSchedule schedule={schedule} />
        <View style={{ height: 40 }} />
      </ScrollView>

      <AccountPicker
        visible={pickerMode !== null}
        onClose={() => setPickerMode(null)}
        onSelect={(acc) => {
          if (pickerMode === 'payment') setPaymentAccount(acc);
          else setInterestAccount(acc);
          setPickerMode(null);
        }}
        allowedTypes={pickerMode === 'payment' ? (['asset'] as AccountType[]) : (['expense'] as AccountType[])}
        selectedId={pickerMode === 'payment' ? paymentAccount?.id : interestAccount?.id}
        bookId={currentBook?.id}
      />

      {/* 删除确认 */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除贷款</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{loan.name}」吗？
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={confirmDelete}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

function LoansPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { loans, summary, isLoading, filterStatus, fetchLoans, fetchSummary, setFilterStatus } =
    useLoanStore();

  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  useEffect(() => {
    if (currentBook) {
      fetchLoans(currentBook.id);
      fetchSummary(currentBook.id);
    }
  }, [currentBook?.id, filterStatus]);

  const handleLoanPress = (loan: LoanResponse) => {
    setSelectedLoanId(loan.id);
  };

  const handleStatusChange = (status: string | null) => {
    setFilterStatus(status);
  };

  const handleBackFromDetail = () => {
    setSelectedLoanId(null);
  };

  const handleLoanDeleted = () => {
    setSelectedLoanId(null);
    if (currentBook) {
      fetchLoans(currentBook.id);
      fetchSummary(currentBook.id);
    }
  };

  // 展示贷款详情
  if (selectedLoanId) {
    return (
      <LoanDetailInline
        loanId={selectedLoanId}
        onBack={handleBackFromDetail}
        onDeleted={handleLoanDeleted}
      />
    );
  }

  if (isLoading && loans.length === 0) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>贷款管理</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]}
          onPress={() => router.push('/loans/new' as any)}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.saveBtnText}>新建贷款</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {/* Summary Card */}
        {summary && (
          <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>贷款总额</Text>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>¥{summary.total_principal.toLocaleString()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>剩余本金</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>¥{summary.total_remaining.toLocaleString()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>已付利息</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.asset }}>¥{summary.total_interest_paid.toLocaleString()}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>
              共 {summary.loan_count} 笔贷款，{summary.active_count} 笔还款中
            </Text>
          </View>
        )}

        {/* Status Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 12 }}
          contentContainerStyle={{ gap: 8, paddingRight: 12 }}
        >
          {LOAN_STATUS_TABS.map((tab) => {
            const active = filterStatus === tab.key;
            return (
              <Pressable
                key={tab.key ?? 'all'}
                style={[
                  styles.acctTab,
                  active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                ]}
                onPress={() => handleStatusChange(tab.key)}
              >
                <Text
                  style={[
                    styles.acctTabText,
                    { color: active ? Colors.primary : colors.textSecondary },
                    active && { fontWeight: '600' },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Loan List */}
        {loans.length === 0 ? (
          <View style={styles.acctEmpty}>
            <FontAwesome name="credit-card" size={40} color={colors.textSecondary} />
            <Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无贷款</Text>
          </View>
        ) : (
          loans.map((loan) => (
            <Pressable
              key={loan.id}
              style={[styles.acctRow, { paddingLeft: 16 }]}
              onPress={() => handleLoanPress(loan)}
            >
              <View style={[styles.iconCircle, { backgroundColor: Colors.liability + '15' }]}>
                <FontAwesome name="credit-card" size={14} color={Colors.liability} />
              </View>
              <View style={styles.acctRowContent}>
                <Text style={styles.acctRowName}>{loan.name}</Text>
                <Text style={[styles.acctRowCode, { color: colors.textSecondary }]}>
                  {LOAN_METHOD_LABEL[loan.repayment_method]} · {loan.annual_rate}%
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>¥{loan.remaining_principal.toLocaleString()}</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                  {loan.repaid_months}/{loan.total_months}期
                </Text>
              </View>
              <View
                style={[
                  styles.directionBadge,
                  { backgroundColor: loan.status === 'paid_off' ? colors.textSecondary + '15' : Colors.liability + '15' },
                ]}
              >
                <Text
                  style={[
                    styles.directionText,
                    { color: loan.status === 'paid_off' ? colors.textSecondary : Colors.liability },
                  ]}
                >
                  {loan.status === 'paid_off' ? '结清' : '还款中'}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Budget Pane (desktop only) ─────────────────────────────

function BudgetPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const currentBook = useBookStore((s) => s.currentBook);
  const { budgets, isLoading, fetchBudgets } = useBudgetStore();

  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetResponse | null>(null);
  const [modalAmount, setModalAmount] = useState('');
  const [modalThreshold, setModalThreshold] = useState('80');
  const [modalAccount, setModalAccount] = useState<AccountTreeNode | null>(null);
  const [isTotalBudget, setIsTotalBudget] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BudgetResponse | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (currentBook) fetchBudgets(currentBook.id);
  }, [currentBook?.id]);

  const totalBudget = budgets.find((b) => b.account_id === null);
  const categoryBudgets = budgets.filter((b) => b.account_id !== null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const openCreateModal = (isTotal: boolean) => {
    setEditingBudget(null);
    setModalAmount('');
    setModalThreshold('80');
    setModalAccount(null);
    setIsTotalBudget(isTotal);
    setModalVisible(true);
  };

  const openEditModal = (budget: BudgetResponse) => {
    setEditingBudget(budget);
    setModalAmount(String(budget.amount));
    setModalThreshold(String(Math.round(budget.alert_threshold * 100)));
    setModalAccount(null);
    setIsTotalBudget(budget.account_id === null);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!currentBook) return;
    const amount = parseFloat(modalAmount);
    if (!amount || amount <= 0) { showToast('请输入有效的预算金额'); return; }
    if (!editingBudget && !isTotalBudget && !modalAccount) { showToast('请选择费用科目'); return; }
    const threshold = parseInt(modalThreshold) / 100;
    setSaving(true);
    try {
      if (editingBudget) {
        await budgetService.updateBudget(editingBudget.id, { amount, alert_threshold: threshold });
      } else {
        await budgetService.createBudget(currentBook.id, { account_id: modalAccount?.id ?? null, amount, alert_threshold: threshold });
      }
      setModalVisible(false);
      await fetchBudgets(currentBook.id);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !currentBook) return;
    try {
      await budgetService.deleteBudget(deleteTarget.id);
      setDeleteTarget(null);
      await fetchBudgets(currentBook.id);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '删除失败');
    }
  };

  if (isLoading && budgets.length === 0) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 标题 */}
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>预算设置</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]}
          onPress={() => openCreateModal(false)}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.saveBtnText}>添加分类</Text>
        </Pressable>
      </View>

      {/* 预算列表 */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 0 }}>
        {/* 总预算 */}
        {totalBudget ? (
          <BudgetCard budget={totalBudget} onPress={() => openEditModal(totalBudget)} onLongPress={() => setDeleteTarget(totalBudget)} />
        ) : (
          <Pressable
            style={[styles.formCard, { backgroundColor: colors.card, padding: 24, alignItems: 'center', marginBottom: 12 }]}
            onPress={() => openCreateModal(true)}
          >
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>+ 设置总预算</Text>
          </Pressable>
        )}

        {/* 分类预算列表 */}
        {categoryBudgets.length === 0 ? (
          <View style={[styles.formCard, { backgroundColor: colors.card, padding: 24, alignItems: 'center', marginBottom: 12 }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>暂无分类预算</Text>
          </View>
        ) : (
          categoryBudgets.map((b) => (
            <BudgetCard key={b.id} budget={b} onPress={() => openEditModal(b)} onLongPress={() => setDeleteTarget(b)} />
          ))
        )}
      </ScrollView>

      {/* 新建/编辑 Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setModalVisible(false)}>
          <Pressable style={[budgetStyles.content, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>
              {editingBudget ? '编辑预算' : isTotalBudget ? '设置总预算' : '添加分类预算'}
            </Text>
            {!editingBudget && !isTotalBudget && (
              <Pressable
                style={[budgetStyles.field, { borderColor: colors.border }]}
                onPress={() => { setModalVisible(false); setTimeout(() => setPickerVisible(true), 300); }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>费用科目</Text>
                <Text style={{ color: modalAccount ? colors.text : colors.textSecondary, fontSize: 14 }}>
                  {modalAccount?.name ?? '请选择费用科目'}
                </Text>
              </Pressable>
            )}
            {editingBudget && (
              <View style={[budgetStyles.field, { borderColor: colors.border }]}>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>科目</Text>
                <Text style={{ color: colors.text, fontSize: 14 }}>{editingBudget.account_name ?? '总预算'}</Text>
              </View>
            )}
            <View style={[budgetStyles.field, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>预算金额</Text>
              <TextInput
                style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', flex: 1 }}
                value={modalAmount} onChangeText={setModalAmount} keyboardType="numeric"
                placeholder="0" placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={[budgetStyles.field, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>提醒阈值 (%)</Text>
              <TextInput
                style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', flex: 1 }}
                value={modalThreshold} onChangeText={setModalThreshold} keyboardType="numeric"
                placeholder="80" placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setModalVisible(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: Colors.primary }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '600' }}>保存</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除预算</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{deleteTarget?.account_name ?? '总预算'}」吗？
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setDeleteTarget(null)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={handleDelete}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* AccountPicker */}
      <AccountPicker
        visible={pickerVisible}
        onClose={() => { setPickerVisible(false); setTimeout(() => setModalVisible(true), 300); }}
        onSelect={(acc) => { setModalAccount(acc); setPickerVisible(false); setTimeout(() => setModalVisible(true), 300); }}
        allowedTypes={['expense'] as AccountType[]}
        selectedId={modalAccount?.id}
        bookId={currentBook?.id}
      />

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const budgetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  content: { width: 320, borderRadius: 14, padding: 24 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  field: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  btns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
});

// ─── Main Profile Screen ────────────────────────────────────

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [activeDetail, setActiveDetail] = useState<DetailPane>('none');

  // 从其他 tab（如 Dashboard）跳转过来时，自动打开指定面板
  const consumePendingPane = useProfileNavStore((s) => s.consume);
  useFocusEffect(
    useCallback(() => {
      const pane = consumePendingPane();
      if (pane && isDesktop) {
        setActiveDetail(pane as DetailPane);
      }
    }, [consumePendingPane, isDesktop])
  );

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('确定要退出登录吗？')) {
        logout();
      }
    } else {
      Alert.alert('退出登录', '确定要退出登录吗？', [
        { text: '取消', style: 'cancel' },
        { text: '退出', style: 'destructive', onPress: logout },
      ]);
    }
  };

  const handleMenuPress = (pane: DetailPane, mobileRoute: string) => {
    if (isDesktop) {
      setActiveDetail(pane);
    } else {
      router.push(mobileRoute as any);
    }
  };

  const menuContent = (
    <ScrollView style={styles.menuScroll}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <FontAwesome name="user" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.name}>{user?.nickname || '用户'}</Text>
        <Text style={[styles.email, { color: colors.textSecondary }]}>{user?.email}</Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="pencil"
          label="编辑个人信息"
          onPress={() => handleMenuPress('edit-profile', '/profile/edit')}
        />
        <MenuItem
          icon="list-alt"
          label="科目管理"
          onPress={() => handleMenuPress('accounts', '/accounts')}
        />
        <MenuItem icon="bank" label="外部账户" hint="即将推出" />
        <MenuItem icon="building" label="固定资产" onPress={() => handleMenuPress('assets', '/assets')} />
        <MenuItem icon="credit-card" label="贷款管理" onPress={() => handleMenuPress('loans', '/loans')} />
        <MenuItem icon="pie-chart" label="预算设置" onPress={() => handleMenuPress('budget', '/settings/budget')} />
        <MenuItem icon="download" label="数据导入/导出" hint="即将推出" />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="cog"
          label="设置"
          color={Colors.neutral}
          onPress={() => handleMenuPress('settings', '/profile/settings')}
        />
        <MenuItem icon="info-circle" label="关于" color={Colors.neutral} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          icon="sign-out"
          label="退出登录"
          color={Colors.asset}
          onPress={handleLogout}
        />
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopContainer}>
        <View style={[styles.desktopMenu, { borderRightColor: colors.border }]}>
          {menuContent}
        </View>
        <View style={styles.desktopDetail}>
          {activeDetail === 'edit-profile' && <EditProfilePane />}
          {activeDetail === 'settings' && <SettingsPane />}
          {activeDetail === 'accounts' && <AccountsPane />}
          {activeDetail === 'assets' && <AssetsPane />}
          {activeDetail === 'loans' && <LoansPane />}
          {activeDetail === 'budget' && <BudgetPane />}
          {activeDetail === 'none' && (
            <View style={styles.detailEmpty}>
              <FontAwesome name="user-circle" size={48} color={colors.textSecondary} />
              <Text style={[styles.detailEmptyText, { color: colors.textSecondary }]}>
                选择左侧菜单项查看详情
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return <View style={styles.container}>{menuContent}</View>;
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  menuScroll: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
  },
  section: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuIcon: {
    width: 28,
    textAlign: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    marginLeft: 12,
  },
  menuHint: {
    fontSize: 12,
    marginRight: 8,
  },
  // Desktop split
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopMenu: {
    width: 380,
    borderRightWidth: 1,
  },
  desktopDetail: {
    flex: 1,
  },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  detailEmptyText: {
    fontSize: 14,
  },
  detailScroll: {
    flexGrow: 0,
  },
  detailContent: {
    padding: 24,
    paddingBottom: 0,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  formCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  formLabel: {
    fontSize: 14,
    width: 80,
  },
  formValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  formInput: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
  saveBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // Accounts pane styles
  acctCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acctTabBar: {
    flexGrow: 0,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  acctTabContent: {
    gap: 8,
    paddingRight: 12,
  },
  acctTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  acctTabText: {
    fontSize: 14,
  },
  acctTabCount: {
    fontSize: 12,
    opacity: 0.7,
  },
  acctList: {
    flex: 1,
  },
  acctRow: {
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
  acctRowContent: {
    flex: 1,
  },
  acctRowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  acctRowCode: {
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
  deleteBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acctEmpty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  acctEmptyText: {
    fontSize: 14,
  },
});
