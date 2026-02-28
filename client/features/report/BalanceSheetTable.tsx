import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { syncService } from '@/services/syncService';
import type { BalanceSheetResponse, AccountBalanceItem } from '@/services/reportService';

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-¥${formatted}` : `¥${formatted}`;
}

type TreeNode = AccountBalanceItem & { children: TreeNode[]; depth: number };

function buildTree(items: AccountBalanceItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const item of items) {
    map.set(item.account_id, { ...item, children: [], depth: 0 });
  }

  for (const item of items) {
    const node = map.get(item.account_id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      const parent = map.get(item.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function flattenTree(nodes: TreeNode[], collapsed: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0 && !collapsed.has(node.account_id)) {
      result.push(...flattenTree(node.children, collapsed));
    }
  }
  return result;
}

type Props = {
  data: BalanceSheetResponse;
  onRefresh?: () => void;
  editable?: boolean; // true when report date is today
};

function AccountTreeRow({
  item,
  hasChildren,
  isCollapsed,
  onToggle,
  onEdit,
  editable,
  colors,
  isMobile,
}: {
  item: TreeNode;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  editable?: boolean;
  colors: any;
  isMobile?: boolean;
}) {
  const [amountHovered, setAmountHovered] = useState(false);
  const balanceColor =
    item.balance > 0
      ? item.account_type === 'liability'
        ? Colors.liability
        : Colors.asset
      : item.balance < 0
      ? Colors.liability
      : colors.text;

  const isParent = hasChildren;
  const indent = item.depth * 20;
  const isLeaf = !hasChildren;
  const canEdit = editable && isLeaf && (item.account_type === 'asset' || item.account_type === 'liability');
  const showEditIcon = canEdit && (isMobile || amountHovered);

  return (
    <Pressable
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={hasChildren ? onToggle : undefined}
      disabled={!hasChildren && !canEdit}
    >
      <View style={[styles.nameCell, { paddingLeft: indent }]}>
        {isParent ? (
          <FontAwesome
            name={isCollapsed ? 'caret-right' : 'caret-down'}
            size={12}
            color={colors.textSecondary}
            style={styles.caretIcon}
          />
        ) : (
          <View style={styles.caretPlaceholder} />
        )}
        <Text style={[styles.name, { color: colors.text }, isParent && styles.parentName]}>
          {item.account_name}
        </Text>
      </View>
      <Pressable
        style={styles.amountCell}
        onPress={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        {...(Platform.OS === 'web' && canEdit ? {
          onHoverIn: () => setAmountHovered(true),
          onHoverOut: () => setAmountHovered(false),
        } as any : {})}
      >
        <Text style={[styles.amount, { color: balanceColor }]}>{formatMoney(item.balance)}</Text>
        {showEditIcon && (
          <FontAwesome name="pencil" size={11} color={colors.textSecondary} style={{ marginLeft: 6 }} />
        )}
      </Pressable>
    </Pressable>
  );
}

function TotalRow({ label, amount, color, colors }: { label: string; amount: number; color?: string; colors: any }) {
  return (
    <View style={[styles.row, styles.totalRow]}>
      <Text style={[styles.totalLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.totalAmount, { color: color ?? colors.text }]}>{formatMoney(amount)}</Text>
    </View>
  );
}

function ReconcileModalBody({
  account,
  onSubmit,
  onCancel,
  submitting,
  colors,
}: {
  account: TreeNode;
  onSubmit: (accountId: string, realBalance: number) => void;
  onCancel: () => void;
  submitting: boolean;
  colors: any;
}) {
  const [inputValue, setInputValue] = useState(account.balance.toFixed(2));
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const realBalance = parseFloat(inputValue) || 0;
  const diff = realBalance - account.balance;
  const diffColor = diff > 0 ? Colors.asset : diff < 0 ? Colors.liability : Colors.neutral;
  const diffSign = diff > 0 ? '+' : '';

  const handleSubmit = () => {
    const val = parseFloat(inputValue);
    if (isNaN(val)) return;
    onSubmit(account.account_id, val);
  };

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === 'Enter') handleSubmit();
    if (e.nativeEvent.key === 'Escape') onCancel();
  };

  return (
    <>
      <Text style={[modalS.title, { color: colors.text }]}>对账 — {account.account_name}</Text>

      <View style={modalS.readonlyRow}>
        <Text style={[modalS.label, { color: colors.textSecondary }]}>账面余额</Text>
        <Text style={[modalS.readonlyValue, { color: colors.text }]}>{formatMoney(account.balance)}</Text>
      </View>

      <View style={modalS.fieldRow}>
        <Text style={[modalS.label, { color: colors.textSecondary }]}>真实余额</Text>
        <TextInput
          ref={inputRef}
          style={[modalS.input, { color: colors.text, borderColor: colors.border }]}
          value={inputValue}
          onChangeText={setInputValue}
          keyboardType="decimal-pad"
          onKeyPress={handleKeyPress}
          selectTextOnFocus
          editable={!submitting}
        />
      </View>

      <View style={modalS.readonlyRow}>
        <Text style={[modalS.label, { color: colors.textSecondary }]}>差异</Text>
        <Text style={[modalS.readonlyValue, { color: diffColor, fontWeight: '600' }]}>
          {inputValue.trim() ? `${diffSign}${formatMoney(diff)}` : '--'}
        </Text>
      </View>

      <View style={modalS.btnRow}>
        <Pressable style={[modalS.btn, { backgroundColor: colors.border }]} onPress={onCancel} disabled={submitting}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
        </Pressable>
        <Pressable
          style={[modalS.btn, { backgroundColor: submitting || !inputValue.trim() || isNaN(parseFloat(inputValue)) ? colors.border : Colors.primary, opacity: submitting ? 0.6 : 1 }]}
          onPress={handleSubmit}
          disabled={submitting || !inputValue.trim() || isNaN(parseFloat(inputValue))}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={{ color: '#FFF', fontWeight: '600' }}>提交对账</Text>
          )}
        </Pressable>
      </View>
    </>
  );
}

function SectionCard({ title, items, totalLabel, totalAmount, totalColor, colors, editable, onEdit, isMobile }: {
  title: string;
  items: AccountBalanceItem[];
  totalLabel: string;
  totalAmount: number;
  totalColor?: string;
  colors: any;
  editable?: boolean;
  onEdit?: (id: string) => void;
  isMobile?: boolean;
}) {
  const tree = useMemo(() => buildTree(items), [items]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visibleNodes = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {visibleNodes.map((node) => (
        <AccountTreeRow
          key={node.account_id}
          item={node}
          hasChildren={node.children.length > 0}
          isCollapsed={collapsed.has(node.account_id)}
          onToggle={() => toggle(node.account_id)}
          onEdit={() => onEdit?.(node.account_id)}
          editable={editable}
          colors={colors}
          isMobile={isMobile}
        />
      ))}
      <TotalRow label={totalLabel} amount={totalAmount} color={totalColor} colors={colors} />
    </View>
  );
}

function EquitySectionCard({ data, colors }: { data: BalanceSheetResponse; colors: any }) {
  const tree = useMemo(() => buildTree(data.equities), [data.equities]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visibleNodes = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>净资产</Text>
      {visibleNodes.map((node) => (
        <AccountTreeRow
          key={node.account_id}
          item={node}
          hasChildren={node.children.length > 0}
          isCollapsed={collapsed.has(node.account_id)}
          onToggle={() => toggle(node.account_id)}
          colors={colors}
        />
      ))}
      {data.net_income !== 0 && (
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={styles.nameCell}>
            <View style={styles.caretPlaceholder} />
            <Text style={[styles.name, { color: colors.text }]}>本期损益</Text>
          </View>
          <Text
            style={[
              styles.amount,
              { color: data.net_income >= 0 ? Colors.asset : Colors.liability },
            ]}
          >
            {formatMoney(data.net_income)}
          </Text>
        </View>
      )}
      <TotalRow
        label="净资产合计"
        amount={data.adjusted_equity}
        color={Colors.primary}
        colors={colors}
      />
    </View>
  );
}

export default function BalanceSheetTable({ data, onRefresh, editable }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop, isMobile } = useBreakpoint();
  const router = useRouter();

  // Editing state
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'warning' | 'error'>('success');
  const [toastLink, setToastLink] = useState(false);

  const showToast = useCallback((msg: string, type: 'success' | 'warning' | 'error' = 'success', link = false) => {
    setToastMsg(msg);
    setToastType(type);
    setToastLink(link);
    const delay = type === 'warning' ? 5000 : type === 'success' ? 1500 : 3000;
    setTimeout(() => { setToastMsg(''); setToastLink(false); }, delay);
  }, []);

  // Find the editing account node from all sections
  const editingAccount = useMemo(() => {
    if (!editingAccountId) return null;
    const allItems = [...data.assets, ...data.liabilities];
    const item = allItems.find((a) => a.account_id === editingAccountId);
    if (!item) return null;
    return { ...item, children: [] as TreeNode[], depth: 0 } as TreeNode;
  }, [editingAccountId, data]);

  const handleEdit = useCallback((id: string) => {
    setEditingAccountId(id);
  }, []);

  const handleCancel = useCallback(() => {
    setEditingAccountId(null);
  }, []);

  const handleSubmitSnapshot = useCallback(async (accountId: string, realBalance: number) => {
    setSubmitting(true);
    try {
      const { data: res } = await syncService.submitSnapshot(accountId, realBalance);
      setEditingAccountId(null);
      if (res.status === 'balanced') {
        showToast('余额一致，无需调节', 'success');
      } else {
        const diffStr = Math.abs(res.difference).toFixed(2);
        showToast(`差异 ¥${diffStr}，已生成调节分录`, 'warning', true);
      }
      onRefresh?.();
    } catch {
      showToast('提交失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onRefresh, showToast]);

  // T 型布局：桌面端左右分栏，移动端上下堆叠
  const leftColumn = (
    <View style={[styles.column, isDesktop && styles.columnHalf]}>
      {data.assets.length > 0 && (
        <SectionCard
          title="资产"
          items={data.assets}
          totalLabel="资产合计"
          totalAmount={data.total_asset}
          totalColor={Colors.asset}
          colors={colors}
          editable={editable}
          onEdit={handleEdit}
          isMobile={isMobile}
        />
      )}
    </View>
  );

  const rightColumn = (
    <View style={[styles.column, isDesktop && styles.columnHalf]}>
      {data.liabilities.length > 0 && (
        <SectionCard
          title="负债"
          items={data.liabilities}
          totalLabel="负债合计"
          totalAmount={data.total_liability}
          totalColor={Colors.liability}
          colors={colors}
          editable={editable}
          onEdit={handleEdit}
          isMobile={isMobile}
        />
      )}
      <EquitySectionCard
          data={data}
          colors={colors}
        />
    </View>
  );

  return (
    <View>
      {/* Toast */}
      {toastMsg ? (
        <View style={[
          styles.toast,
          { backgroundColor: toastType === 'success' ? '#D1FAE5' : toastType === 'warning' ? '#FEF3C7' : '#FEE2E2' },
        ]}>
          <Text style={{ color: toastType === 'success' ? '#059669' : toastType === 'warning' ? '#D97706' : '#DC2626', fontSize: 13, fontWeight: '600', flex: 1 }}>
            {toastType === 'success' ? '✓ ' : toastType === 'warning' ? '⚠ ' : ''}{toastMsg}
          </Text>
          {toastLink && (
            <Pressable onPress={() => { setToastMsg(''); router.push('/sync/reconcile' as any); }}>
              <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>前往确认分类 →</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* 对账 Modal（桌面端 + 移动端统一） */}
      {editingAccountId && editingAccount && (
        <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
          <Pressable style={modalS.overlay} onPress={handleCancel}>
            <Pressable
              style={[modalS.content, { backgroundColor: colors.card }]}
              onPress={(e) => e.stopPropagation()}
            >
              <ReconcileModalBody
                account={editingAccount}
                onSubmit={handleSubmitSnapshot}
                onCancel={handleCancel}
                submitting={submitting}
                colors={colors}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 摘要卡片 */}
      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总资产</Text>
            <Text style={[styles.summaryValue, { color: Colors.asset }]}>
              {formatMoney(data.total_asset)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>总负债</Text>
            <Text style={[styles.summaryValue, { color: Colors.liability }]}>
              {formatMoney(data.total_liability)}
            </Text>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>净资产</Text>
            <Text style={[styles.summaryValue, { color: Colors.primary }]}>
              {formatMoney(data.adjusted_equity)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>本期损益</Text>
            <Text
              style={[
                styles.summaryValue,
                { color: data.net_income >= 0 ? Colors.asset : Colors.liability },
              ]}
            >
              {formatMoney(data.net_income)}
            </Text>
          </View>
        </View>
        {!data.is_balanced && (
          <View style={styles.warningBadge}>
            <Text style={styles.warningText}>资产负债不平衡</Text>
          </View>
        )}
      </View>

      {/* T 型布局主体 */}
      <View style={[styles.tLayout, isDesktop && styles.tLayoutRow]}>
        {leftColumn}
        {rightColumn}
      </View>

      {/* 等式校验行 */}
      <View style={[styles.equationCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.equationText, { color: colors.text }]}>
          资产{' '}
          <Text style={{ color: Colors.asset }}>{formatMoney(data.total_asset)}</Text>
          {' = 负债 '}
          <Text style={{ color: Colors.liability }}>{formatMoney(data.total_liability)}</Text>
          {' + 净资产 '}
          <Text style={{ color: Colors.primary }}>{formatMoney(data.adjusted_equity)}</Text>
        </Text>
        <View style={[styles.checkBadge, { backgroundColor: data.is_balanced ? '#D1FAE5' : '#FEF3C7' }]}>
          <Text style={{ color: data.is_balanced ? '#059669' : '#D97706', fontSize: 12, fontWeight: '600' }}>
            {data.is_balanced ? '✓ 平衡' : '✗ 不平衡'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  warningBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  warningText: {
    color: '#D97706',
    fontSize: 12,
    fontWeight: '500',
  },
  tLayout: {
    gap: 12,
  },
  tLayoutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flex: 1,
  },
  columnHalf: {
    flex: 1,
  },
  sectionCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameCell: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  caretIcon: {
    width: 12,
    textAlign: 'center',
  },
  caretPlaceholder: {
    width: 12,
  },
  parentName: {
    fontWeight: '600',
  },
  name: {
    fontSize: 14,
  },
  amount: {
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalRow: {
    borderBottomWidth: 0,
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  equationCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  equationText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  checkBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  amountCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    gap: 8,
  },
});

const modalS = StyleSheet.create({
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
  readonlyValue: {
    fontSize: 14,
    fontVariant: ['tabular-nums'] as any,
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
    fontVariant: ['tabular-nums'] as any,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
