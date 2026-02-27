import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  importService,
  type ImportUploadResponse,
  type ImportHistoryItem,
} from '@/services/importService';
import { ImportHistory } from '@/features/import';
import ImportFilterBar from '@/features/import/ImportFilterBar';
import { AccountPicker } from '@/features/entry';
import type { AccountTreeNode } from '@/services/accountService';

const DIRECTION_COLOR: Record<string, string> = {
  '支出': '#EF4444',
  '收入': '#10B981',
  '中性交易': '#6B7280',
};

export default function DataImportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
  const { currentBook } = useBookStore();
  const bookId = currentBook?.id;

  // ─── 上传 / 历史 ───
  const [uploadResult, setUploadResult] = useState<ImportUploadResponse | null>(null);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [toastMsg, setToastMsg] = useState('');

  // ─── 预览状态 ───
  const [filters, setFilters] = useState({ direction: null as string | null, paymentMethod: null as string | null });
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [importedIndexes, setImportedIndexes] = useState<Set<number>>(new Set());
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);
  const [targetAccountName, setTargetAccountName] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(null);
  const [paymentAccountName, setPaymentAccountName] = useState('');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [fromAccountName, setFromAccountName] = useState('');
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [toAccountName, setToAccountName] = useState('');
  const [pickerMode, setPickerMode] = useState<'target' | 'payment' | 'from' | 'to' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const loadHistory = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await importService.history(bookId);
      setHistory(res.data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (isDesktop) { router.back(); return; }
    loadHistory();
  }, [isDesktop, loadHistory]);

  // ─── 上传 ───
  const handleUpload = async () => {
    if (!bookId) { showToast('请先选择账本'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setUploading(true);
      const file = result.assets[0];
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const resp = await fetch(file.uri);
        const blob = await resp.blob();
        formData.append('file', blob, file.name);
      } else {
        formData.append('file', {
          uri: file.uri, name: file.name,
          type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        } as any);
      }
      const res = await importService.upload(bookId, formData);
      setUploadResult(res.data);
      // 重置预览状态，direction 默认选第一个方向
      const firstDir = res.data.filters?.directions?.[0] ?? null;
      setFilters({ direction: firstDir, paymentMethod: null });
      setSelectedIndexes(new Set());
      setImportedIndexes(new Set());
      setTargetAccountId(null); setTargetAccountName('');
      setPaymentAccountId(null); setPaymentAccountName('');
      setFromAccountId(null); setFromAccountName('');
      setToAccountId(null); setToAccountName('');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '上传失败';
      showToast(typeof msg === 'string' ? msg : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImport = async (taskId: string) => {
    if (!bookId) return;
    try {
      await importService.delete(bookId, taskId);
      showToast('已撤销');
      await loadHistory();
    } catch { showToast('撤销失败'); }
  };

  // ─── 预览逻辑 ───
  const filteredRows = useMemo(() => {
    if (!uploadResult) return [];
    return uploadResult.rows.filter((row) => {
      if (filters.direction && row.direction !== filters.direction) return false;
      if (filters.paymentMethod && row.payment_method !== filters.paymentMethod) return false;
      return true;
    });
  }, [uploadResult?.rows, filters]);

  const selectableRows = useMemo(() =>
    filteredRows.filter((r) => !importedIndexes.has(r.index) && !r.is_duplicate),
    [filteredRows, importedIndexes],
  );

  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIndexes.has(r.index));

  const toggleSelectAll = () => {
    setSelectedIndexes(allSelected ? new Set() : new Set(selectableRows.map((r) => r.index)));
  };

  const toggleRow = (index: number) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const selectedDirection = useMemo(() => {
    if (!uploadResult) return null;
    const selected = uploadResult.rows.filter((r) => selectedIndexes.has(r.index));
    if (selected.length === 0) return null;
    const dirs = new Set(selected.map((r) => r.direction));
    return dirs.size === 1 ? selected[0].direction : null;
  }, [uploadResult?.rows, selectedIndexes]);

  const pickerAllowedTypes = useMemo(() => {
    if (pickerMode === 'target') {
      if (selectedDirection === '支出') return ['expense'] as any;
      if (selectedDirection === '收入') return ['income'] as any;
    }
    if (pickerMode === 'payment' || pickerMode === 'from' || pickerMode === 'to') return ['asset'] as any;
    return undefined;
  }, [pickerMode, selectedDirection]);

  const handlePickerSelect = (account: AccountTreeNode) => {
    switch (pickerMode) {
      case 'target': setTargetAccountId(account.id); setTargetAccountName(account.name); break;
      case 'payment': setPaymentAccountId(account.id); setPaymentAccountName(account.name); break;
      case 'from': setFromAccountId(account.id); setFromAccountName(account.name); break;
      case 'to': setToAccountId(account.id); setToAccountName(account.name); break;
    }
  };

  const canConfirm = useMemo(() => {
    if (selectedIndexes.size === 0 || !selectedDirection) return false;
    if (selectedDirection === '支出' || selectedDirection === '收入') return !!targetAccountId && !!paymentAccountId;
    if (selectedDirection === '中性交易') return !!fromAccountId && !!toAccountId;
    return false;
  }, [selectedIndexes, selectedDirection, targetAccountId, paymentAccountId, fromAccountId, toAccountId]);

  const handleConfirm = async () => {
    if (!canConfirm || !uploadResult || !bookId) return;
    setConfirming(true);
    try {
      const indexes = Array.from(selectedIndexes);
      const group = {
        indexes,
        expense_account_id: selectedDirection === '支出' ? targetAccountId : null,
        income_account_id: selectedDirection === '收入' ? targetAccountId : null,
        payment_account_id: (selectedDirection === '支出' || selectedDirection === '收入') ? paymentAccountId : null,
        from_account_id: selectedDirection === '中性交易' ? fromAccountId : null,
        to_account_id: selectedDirection === '中性交易' ? toAccountId : null,
      };
      const res = await importService.confirm(bookId, uploadResult.task_id, { entries: [group] });
      setImportedIndexes((prev) => new Set([...prev, ...indexes]));
      setSelectedIndexes(new Set());
      showToast(`已导入 ${res.data.imported_rows} 条${res.data.skipped_rows > 0 ? `，跳过 ${res.data.skipped_rows} 条` : ''}`);
      if (res.data.status === 'imported') {
        setTimeout(() => { setUploadResult(null); loadHistory(); }, 1000);
      }
    } catch { showToast('导入失败'); }
    finally { setConfirming(false); }
  };

  const totalImported = importedIndexes.size;

  if (isDesktop) return null;

  // ═══════════════════════════════════════════
  // 预览模式
  // ═══════════════════════════════════════════
  if (uploadResult && bookId) {
    return (
      <View style={s.container}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setUploadResult(null)} style={s.backBtn}>
            <FontAwesome name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Text style={[s.headerTitle, { color: colors.text }]}>
            预览（{uploadResult.total_rows} 行，已导入 {totalImported}）
          </Text>
          {totalImported > 0 ? (
            <Pressable onPress={() => { setUploadResult(null); loadHistory(); }} style={s.backBtn}>
              <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: '600' }}>完成</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        {/* Summary */}
        <View style={[s.summary, { backgroundColor: colors.card }]}>
          <View style={s.summaryRow}>
            <Text style={[s.summaryLabel, { color: '#EF4444' }]}>支出 {uploadResult.summary.expense_count} 笔</Text>
            <Text style={[s.summaryValue, { color: '#EF4444' }]}>¥{Number(uploadResult.summary.expense_total).toFixed(2)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={[s.summaryLabel, { color: '#10B981' }]}>收入 {uploadResult.summary.income_count} 笔</Text>
            <Text style={[s.summaryValue, { color: '#10B981' }]}>¥{Number(uploadResult.summary.income_total).toFixed(2)}</Text>
          </View>
          {uploadResult.summary.neutral_count > 0 && (
            <View style={s.summaryRow}>
              <Text style={[s.summaryLabel, { color: '#6B7280' }]}>中性 {uploadResult.summary.neutral_count} 笔</Text>
              <Text style={[s.summaryValue, { color: '#6B7280' }]}>¥{Number(uploadResult.summary.neutral_total).toFixed(2)}</Text>
            </View>
          )}
          {uploadResult.summary.duplicate_count > 0 && (
            <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>
              ⚠ 发现 {uploadResult.summary.duplicate_count} 条重复记录（将自动跳过）
            </Text>
          )}
        </View>

        {/* Filters */}
        <ImportFilterBar filters={uploadResult.filters} value={filters} onChange={setFilters} />

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
                style={[s.row, { borderBottomColor: colors.border }, isDisabled && { opacity: 0.45 }]}
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
                    <Text style={[s.rowDesc, { color: colors.text }]} numberOfLines={1}>{row.description}</Text>
                    <Text style={[s.rowAmount, { color: dirColor }]}>
                      {row.direction === '收入' ? '+' : row.direction === '支出' ? '-' : ''}
                      ¥{Number(row.amount).toFixed(2)}
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
                <Pressable style={[s.accountBtn, { borderColor: colors.border }]} onPress={() => setPickerMode('target')}>
                  <Text style={{ fontSize: 13, color: targetAccountId ? colors.text : colors.textSecondary }}>
                    {targetAccountName || (selectedDirection === '支出' ? '选择费用科目' : '选择收入科目')}
                  </Text>
                  <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
                </Pressable>
                <Pressable style={[s.accountBtn, { borderColor: colors.border }]} onPress={() => setPickerMode('payment')}>
                  <Text style={{ fontSize: 13, color: paymentAccountId ? colors.text : colors.textSecondary }}>
                    {paymentAccountName || '选择支付科目'}
                  </Text>
                  <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
            {selectedDirection === '中性交易' && (
              <>
                <Pressable style={[s.accountBtn, { borderColor: colors.border }]} onPress={() => setPickerMode('from')}>
                  <Text style={{ fontSize: 13, color: fromAccountId ? colors.text : colors.textSecondary }}>
                    {fromAccountName || '选择转出科目'}
                  </Text>
                  <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
                </Pressable>
                <Pressable style={[s.accountBtn, { borderColor: colors.border }]} onPress={() => setPickerMode('to')}>
                  <Text style={{ fontSize: 13, color: toAccountId ? colors.text : colors.textSecondary }}>
                    {toAccountName || '选择转入科目'}
                  </Text>
                  <FontAwesome name="chevron-down" size={10} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
            <Pressable
              style={[s.confirmBtn, { backgroundColor: canConfirm ? Colors.primary : Colors.primary + '40' }]}
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

  // ═══════════════════════════════════════════
  // 默认模式：上传 + 历史
  // ═══════════════════════════════════════════
  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>数据导入</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Upload area */}
        <Pressable
          style={[s.uploadArea, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12 }}>正在上传解析...</Text>
            </>
          ) : (
            <>
              <View style={[s.uploadIcon, { backgroundColor: Colors.primary + '12' }]}>
                <FontAwesome name="cloud-upload" size={32} color={Colors.primary} />
              </View>
              <Text style={[s.uploadTitle, { color: colors.text }]}>上传微信账单</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>
                支持微信「账单 → 导出账单」功能导出的 .xlsx 文件
              </Text>
              <View style={[s.uploadBtn, { backgroundColor: Colors.primary }]}>
                <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>选择文件</Text>
              </View>
            </>
          )}
        </Pressable>

        {/* History */}
        {loadingHistory ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <ImportHistory items={history} onDelete={handleDeleteImport} />
        )}
      </ScrollView>

      {/* Toast */}
      {toastMsg ? (
        <View
          style={[
            s.toast,
            {
              backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误')
                ? '#EF4444'
                : Colors.primary,
            },
          ]}
        >
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : (StatusBar.currentHeight ?? 52) + 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  content: { padding: 16, gap: 20, paddingBottom: 80 },
  uploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  uploadTitle: { fontSize: 16, fontWeight: '600' },
  uploadBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  // ─── 预览样式 ───
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
