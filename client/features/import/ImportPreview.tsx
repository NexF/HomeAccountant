import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { formatMoney } from '@/utils/format';
import { usePrivacyStore } from '@/stores/privacyStore';
import { AccountPicker } from '@/features/entry';
import {
  importService,
  type ImportUploadResponse,
  type ImportRowItem,
} from '@/services/importService';
import type { AccountTreeNode } from '@/services/accountService';
import ImportFilterBar from './ImportFilterBar';

type Props = {
  bookId: string;
  data: ImportUploadResponse;
  onDone: () => void;
  onCancel: () => void;
};

const DIRECTION_COLOR: Record<string, string> = {
  '支出': '#EF4444',
  '收入': '#10B981',
  '中性交易': '#6B7280',
};

export default function ImportPreview({ bookId, data, onDone, onCancel }: Props) {
  const _privacyMode = usePrivacyStore((s) => s.hideAmounts);
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [filters, setFilters] = useState({
    direction: null as string | null,
    paymentMethod: null as string | null,
  });
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [importedIndexes, setImportedIndexes] = useState<Set<number>>(new Set());

  // 科目选择
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);
  const [targetAccountName, setTargetAccountName] = useState<string>('');
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(null);
  const [paymentAccountName, setPaymentAccountName] = useState<string>('');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [fromAccountName, setFromAccountName] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [toAccountName, setToAccountName] = useState<string>('');

  const [pickerMode, setPickerMode] = useState<'target' | 'payment' | 'from' | 'to' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  // 筛选
  const filteredRows = useMemo(() => {
    return data.rows.filter((row) => {
      if (filters.direction && row.direction !== filters.direction) return false;
      if (filters.paymentMethod && row.payment_method !== filters.paymentMethod) return false;
      return true;
    });
  }, [data.rows, filters]);

  // 可选行（排除已导入和重复行）
  const selectableRows = useMemo(() => {
    return filteredRows.filter(
      (r) => !importedIndexes.has(r.index) && !r.is_duplicate
    );
  }, [filteredRows, importedIndexes]);

  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIndexes.has(r.index));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIndexes(new Set());
    } else {
      setSelectedIndexes(new Set(selectableRows.map((r) => r.index)));
    }
  };

  const toggleRow = (index: number) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // 当前选中行的方向
  const selectedDirection = useMemo(() => {
    const selected = data.rows.filter((r) => selectedIndexes.has(r.index));
    if (selected.length === 0) return null;
    const dirs = new Set(selected.map((r) => r.direction));
    return dirs.size === 1 ? selected[0].direction : null;
  }, [data.rows, selectedIndexes]);

  const pickerAllowedTypes = useMemo(() => {
    if (pickerMode === 'target') {
      if (selectedDirection === '支出') return ['expense'] as any;
      if (selectedDirection === '收入') return ['income'] as any;
    }
    if (pickerMode === 'payment' || pickerMode === 'from' || pickerMode === 'to') {
      return ['asset'] as any;
    }
    return undefined;
  }, [pickerMode, selectedDirection]);

  const handlePickerSelect = (account: AccountTreeNode) => {
    switch (pickerMode) {
      case 'target':
        setTargetAccountId(account.id);
        setTargetAccountName(account.name);
        break;
      case 'payment':
        setPaymentAccountId(account.id);
        setPaymentAccountName(account.name);
        break;
      case 'from':
        setFromAccountId(account.id);
        setFromAccountName(account.name);
        break;
      case 'to':
        setToAccountId(account.id);
        setToAccountName(account.name);
        break;
    }
  };

  const canConfirm = useMemo(() => {
    if (selectedIndexes.size === 0 || !selectedDirection) return false;
    if (selectedDirection === '支出' || selectedDirection === '收入') {
      return !!targetAccountId && !!paymentAccountId;
    }
    if (selectedDirection === '中性交易') {
      return !!fromAccountId && !!toAccountId;
    }
    return false;
  }, [selectedIndexes, selectedDirection, targetAccountId, paymentAccountId, fromAccountId, toAccountId]);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setConfirming(true);
    try {
      const indexes = Array.from(selectedIndexes);
      const group = {
        indexes,
        expense_account_id: selectedDirection === '支出' ? targetAccountId : null,
        income_account_id: selectedDirection === '收入' ? targetAccountId : null,
        payment_account_id:
          selectedDirection === '支出' || selectedDirection === '收入'
            ? paymentAccountId
            : null,
        from_account_id: selectedDirection === '中性交易' ? fromAccountId : null,
        to_account_id: selectedDirection === '中性交易' ? toAccountId : null,
      };
      const res = await importService.confirm(bookId, data.task_id, {
        entries: [group],
      });
      setImportedIndexes((prev) => new Set([...prev, ...indexes]));
      setSelectedIndexes(new Set());
      showToast(`已导入 ${res.data.imported_rows} 条${res.data.skipped_rows > 0 ? `，跳过 ${res.data.skipped_rows} 条` : ''}`);

      // 全部导入完成
      if (res.data.status === 'imported') {
        setTimeout(onDone, 1000);
      }
    } catch {
      showToast('导入失败');
    } finally {
      setConfirming(false);
    }
  };

  const totalImported = importedIndexes.size;
  const totalRows = data.total_rows;

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={onCancel} style={s.headerBtn}>
          <FontAwesome name="arrow-left" size={16} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>
          预览（{totalRows} 行，已导入 {totalImported}）
        </Text>
        {totalImported > 0 && (
          <Pressable onPress={onDone} style={s.headerBtn}>
            <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: '600' }}>完成</Text>
          </Pressable>
        )}
      </View>

      {/* Summary */}
      <View style={[s.summary, { backgroundColor: colors.card }]}>
        <View style={s.summaryRow}>
          <Text style={[s.summaryLabel, { color: '#EF4444' }]}>支出 {data.summary.expense_count} 笔</Text>
          <Text style={[s.summaryValue, { color: '#EF4444' }]}>{formatMoney(Number(data.summary.expense_total))}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={[s.summaryLabel, { color: '#10B981' }]}>收入 {data.summary.income_count} 笔</Text>
          <Text style={[s.summaryValue, { color: '#10B981' }]}>{formatMoney(Number(data.summary.income_total))}</Text>
        </View>
        {data.summary.neutral_count > 0 && (
          <View style={s.summaryRow}>
            <Text style={[s.summaryLabel, { color: '#6B7280' }]}>中性 {data.summary.neutral_count} 笔</Text>
            <Text style={[s.summaryValue, { color: '#6B7280' }]}>{formatMoney(Number(data.summary.neutral_total))}</Text>
          </View>
        )}
        {data.summary.duplicate_count > 0 && (
          <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>
            ⚠ 发现 {data.summary.duplicate_count} 条重复记录（将自动跳过）
          </Text>
        )}
      </View>

      {/* Filters */}
      <ImportFilterBar
        filters={data.filters}
        value={filters}
        onChange={setFilters}
      />

      {/* Select all */}
      <Pressable style={[s.selectAll, { borderBottomColor: colors.border }]} onPress={toggleSelectAll}>
        <FontAwesome
          name={allSelected ? 'check-square' : 'square-o'}
          size={18}
          color={allSelected ? Colors.primary : colors.textSecondary}
        />
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginLeft: 8 }}>
          {allSelected ? '取消全选' : '全选'} ({selectableRows.length} 条可选)
        </Text>
      </Pressable>

      {/* Row list */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 180 }}>
        {filteredRows.map((row) => {
          const isImported = importedIndexes.has(row.index);
          const isDuplicate = row.is_duplicate;
          const isDisabled = isImported || isDuplicate;
          const isSelected = selectedIndexes.has(row.index);
          const dirColor = DIRECTION_COLOR[row.direction] || '#6B7280';

          return (
            <Pressable
              key={row.index}
              style={[
                s.row,
                { borderBottomColor: colors.border },
                isDisabled && { opacity: 0.45 },
              ]}
              onPress={() => !isDisabled && toggleRow(row.index)}
              disabled={isDisabled}
            >
              <FontAwesome
                name={isDisabled ? (isImported ? 'check-circle' : 'ban') : isSelected ? 'check-square' : 'square-o'}
                size={16}
                color={isDisabled ? '#9CA3AF' : isSelected ? Colors.primary : colors.textSecondary}
                style={s.rowCheck}
              />
              <View style={s.rowContent}>
                <View style={s.rowTop}>
                  <Text style={[s.rowDesc, { color: colors.text }]} numberOfLines={1}>
                    {row.description}
                  </Text>
                  <Text
                    style={[
                      s.rowAmount,
                      { color: dirColor },
                    ]}
                  >
                    {row.direction === '收入' ? '+' : row.direction === '支出' ? '-' : ''}
                    {formatMoney(Number(row.amount))}
                  </Text>
                </View>
                <View style={s.rowBottom}>
                  <View style={[s.dirBadge, { backgroundColor: dirColor + '12' }]}>
                    <Text style={{ fontSize: 10, color: dirColor, fontWeight: '600' }}>{row.direction}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }}>{row.date}</Text>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>{row.payment_method}</Text>
                  {isImported && <Text style={{ fontSize: 10, color: '#10B981' }}>已导入</Text>}
                  {isDuplicate && <Text style={{ fontSize: 10, color: '#F59E0B' }}>重复</Text>}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Bottom action bar */}
      {selectedIndexes.size > 0 && selectedDirection && (
        <View style={[s.actionBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <Text style={[s.actionCount, { color: colors.text }]}>
            已选 {selectedIndexes.size} 条（{selectedDirection}）
          </Text>

          {(selectedDirection === '支出' || selectedDirection === '收入') && (
            <>
              <Pressable
                style={[s.accountBtn, { borderColor: colors.border }]}
                onPress={() => setPickerMode('target')}
              >
                <Text style={{ fontSize: 13, color: targetAccountId ? colors.text : colors.textSecondary }}>
                  {targetAccountName || (selectedDirection === '支出' ? '选择费用科目' : '选择收入科目')}
                </Text>
                <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={[s.accountBtn, { borderColor: colors.border }]}
                onPress={() => setPickerMode('payment')}
              >
                <Text style={{ fontSize: 13, color: paymentAccountId ? colors.text : colors.textSecondary }}>
                  {paymentAccountName || '选择支付科目'}
                </Text>
                <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
              </Pressable>
            </>
          )}

          {selectedDirection === '中性交易' && (
            <>
              <Pressable
                style={[s.accountBtn, { borderColor: colors.border }]}
                onPress={() => setPickerMode('from')}
              >
                <Text style={{ fontSize: 13, color: fromAccountId ? colors.text : colors.textSecondary }}>
                  {fromAccountName || '选择转出科目'}
                </Text>
                <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={[s.accountBtn, { borderColor: colors.border }]}
                onPress={() => setPickerMode('to')}
              >
                <Text style={{ fontSize: 13, color: toAccountId ? colors.text : colors.textSecondary }}>
                  {toAccountName || '选择转入科目'}
                </Text>
                <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
              </Pressable>
            </>
          )}

          <Pressable
            style={[
              s.confirmBtn,
              { backgroundColor: canConfirm ? Colors.primary : Colors.primary + '40' },
            ]}
            onPress={handleConfirm}
            disabled={!canConfirm || confirming}
          >
            {confirming ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>确认导入</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Account Picker */}
      <AccountPicker
        visible={pickerMode !== null}
        onClose={() => setPickerMode(null)}
        onSelect={handlePickerSelect}
        allowedTypes={pickerAllowedTypes}
        selectedId={
          pickerMode === 'target' ? (targetAccountId ?? undefined)
            : pickerMode === 'payment' ? (paymentAccountId ?? undefined)
            : pickerMode === 'from' ? (fromAccountId ?? undefined)
            : pickerMode === 'to' ? (toAccountId ?? undefined)
            : undefined
        }
        bookId={bookId}
      />

      {/* Toast */}
      {toastMsg ? (
        <View style={[s.toast, { backgroundColor: toastMsg.includes('失败') ? '#EF4444' : Colors.primary }]}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  summary: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 13, fontWeight: '500' },
  summaryValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowCheck: { width: 24 },
  rowContent: { flex: 1, marginLeft: 8, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowDesc: { flex: 1, fontSize: 14, fontWeight: '500', marginRight: 8 },
  rowAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dirBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  actionCount: { fontSize: 14, fontWeight: '600' },
  accountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  confirmBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 999,
  },
});
