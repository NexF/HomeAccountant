import React, { useEffect, useCallback, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useEntryStore } from '@/stores/entryStore';
import EntryCard from '@/features/entry/EntryCard';
import type { EntryResponse, EntryType } from '@/services/entryService';
import { entryService, ALLOWED_CONVERSIONS } from '@/services/entryService';
import { ENTRY_TYPES } from '@/features/entry/EntryTypeTab';
import { AccountPicker } from '@/features/entry';
import NewEntryScreen from '@/app/entry/new';

const FILTER_TABS = [
  { key: null, label: '全部' },
  { key: 'expense', label: '费用' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
  { key: 'asset_purchase', label: '购置资产' },
  { key: 'asset_dispose', label: '处置资产' },
  { key: 'depreciation', label: '折旧' },
  { key: 'repay', label: '还款' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  expense: '费用',
  income: '收入',
  asset_purchase: '购置资产',
  asset_dispose: '处置资产',
  borrow: '借入',
  repay: '还款',
  transfer: '转账',
  manual: '手工',
  depreciation: '折旧',
  reconciliation: '对账调节',
};

/** 按日期分组 */
function groupByDate(entries: EntryResponse[]): { date: string; items: EntryResponse[] }[] {
  const map = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const d = e.entry_date;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function EntryDetailPane({
  entryId,
  colors,
  onDeleted,
  onEdit,
}: {
  entryId: string;
  colors: typeof Colors.light;
  onDeleted?: () => void;
  onEdit?: (id: string) => void;
}) {
  const router = useRouter();
  const [entry, setEntry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // 转换类型状态
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertTarget, setConvertTarget] = useState<EntryType | null>(null);
  const [convertCategoryId, setConvertCategoryId] = useState<string | undefined>();
  const [convertPaymentId, setConvertPaymentId] = useState<string | undefined>();
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [converting, setConverting] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [paymentName, setPaymentName] = useState('');
  const currentBook = useBookStore((s) => s.currentBook);

  const fetchEntry = () => {
    setLoading(true);
    entryService
      .getEntry(entryId)
      .then(({ data }) => setEntry(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEntry();
  }, [entryId]);

  // 页面聚焦时刷新（编辑返回后自动更新）
  useFocusEffect(
    useCallback(() => {
      if (entryId) fetchEntry();
    }, [entryId])
  );

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleDelete = () => {
    if (!entry) return;
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!entry) return;
    try {
      await entryService.deleteEntry(entry.id);
      setShowDeleteModal(false);
      onDeleted?.();
    } catch {
      setShowDeleteModal(false);
      showToast('错误', '删除失败');
    }
  };

  // 转换类型
  const canConvert = !!ALLOWED_CONVERSIONS[entry?.entry_type as EntryType]?.length;
  const allowedTargets = entry ? ALLOWED_CONVERSIONS[entry.entry_type as EntryType] ?? [] : [];

  const openConvertModal = () => {
    setConvertTarget(null);
    setConvertCategoryId(undefined);
    setConvertPaymentId(undefined);
    setCategoryName('');
    setPaymentName('');
    setShowConvertModal(true);
  };

  const handleConvert = async () => {
    if (!entry || !convertTarget) return;
    setConverting(true);
    try {
      const { data } = await entryService.convertEntryType(entry.id, {
        target_type: convertTarget,
        category_account_id: convertCategoryId,
        payment_account_id: convertPaymentId,
      });
      setEntry(data);
      setShowConvertModal(false);
      showToast('成功', `已转换为${TYPE_LABELS[convertTarget] ?? convertTarget}`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? '转换失败';
      showToast('错误', msg);
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.detailCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.detailCenter}>
        <Text style={{ color: colors.textSecondary }}>无法加载分录详情</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      {/* Header with title + action buttons */}
      <View style={styles.detailHeader}>
        <Text style={[styles.detailTitle, { color: colors.text }]}>
          {TYPE_LABELS[entry.entry_type] || entry.entry_type}
        </Text>
        <View style={styles.detailActions}>
          {canConvert && (
            <Pressable disabled style={[styles.headerBtn, { opacity: 0.3 }]}>
              <FontAwesome name="exchange" size={16} color={Colors.neutral} />
            </Pressable>
          )}
          <Pressable
            onPress={() => onEdit ? onEdit(entryId) : router.push(`/entry/new?editId=${entryId}` as any)}
            style={styles.headerBtn}
          >
            <FontAwesome name="pencil" size={18} color={Colors.primary} />
          </Pressable>
          <Pressable onPress={handleDelete} style={styles.headerBtn}>
            <FontAwesome name="trash" size={18} color={Colors.asset} />
          </Pressable>
        </View>
      </View>

      <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>日期</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>{entry.entry_date}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>摘要</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>
            {entry.description || '-'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>备注</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>
            {entry.note || '-'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>来源</Text>
          <Text style={[styles.detailValue, { color: colors.text }]}>{entry.source}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>借贷平衡</Text>
          <Text
            style={[
              styles.detailValue,
              { color: entry.is_balanced ? Colors.liability : Colors.asset },
            ]}
          >
            {entry.is_balanced ? '是' : '否'}
          </Text>
        </View>
      </View>

      {/* Lines */}
      {entry.lines && entry.lines.length > 0 && (
        <>
          <Text style={[styles.detailSubtitle, { color: colors.text }]}>借贷明细</Text>
          <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
            <View style={[styles.lineHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.lineHeaderCell, styles.lineAccount, { color: colors.textSecondary }]}>科目</Text>
              <Text style={[styles.lineHeaderCell, styles.lineAmount, { color: colors.textSecondary }]}>借方</Text>
              <Text style={[styles.lineHeaderCell, styles.lineAmount, { color: colors.textSecondary }]}>贷方</Text>
            </View>
            {entry.lines.map((line: any) => (
              <View key={line.id} style={[styles.lineRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.lineCell, styles.lineAccount, { color: colors.text }]} numberOfLines={1}>
                  {line.account_name || line.account_id}
                </Text>
                <Text style={[styles.lineCell, styles.lineAmount, { fontVariant: ['tabular-nums'] }]}>
                  {Number(line.debit_amount) > 0 ? Number(line.debit_amount).toFixed(2) : '-'}
                </Text>
                <Text style={[styles.lineCell, styles.lineAmount, { fontVariant: ['tabular-nums'] }]}>
                  {Number(line.credit_amount) > 0 ? Number(line.credit_amount).toFixed(2) : '-'}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* 时间信息 */}
      <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>创建时间</Text>
          <Text style={[styles.detailValue, { color: colors.textSecondary, fontSize: 13 }]}>
            {new Date(entry.created_at).toLocaleString()}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>更新时间</Text>
          <Text style={[styles.detailValue, { color: colors.textSecondary, fontSize: 13 }]}>
            {new Date(entry.updated_at).toLocaleString()}
          </Text>
        </View>
      </View>
    </ScrollView>

    {/* 删除确认 Modal */}
    <Modal
      visible={showDeleteModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowDeleteModal(false)}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={() => setShowDeleteModal(false)}
      >
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>删除分录</Text>
          <Text style={[styles.modalMsg, { color: colors.textSecondary }]}>
            确定要删除该分录吗？删除后无法恢复。
          </Text>
          <View style={styles.modalBtns}>
            <Pressable
              style={[styles.modalBtn, { backgroundColor: colors.background }]}
              onPress={() => setShowDeleteModal(false)}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
              onPress={confirmDelete}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>删除</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>

    {/* 转换类型 Modal */}
    <Modal
      visible={showConvertModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowConvertModal(false)}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={() => setShowConvertModal(false)}
      >
        <Pressable onPress={(e) => e.stopPropagation?.()} style={{ width: '85%', maxWidth: 420 }}>
          <View style={[styles.convertSheet, { backgroundColor: colors.card }]}>
            <View style={styles.convertSheetHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>转换分录类型</Text>
              <Pressable onPress={() => setShowConvertModal(false)} style={styles.headerBtn}>
                <FontAwesome name="close" size={18} color={colors.text} />
              </Pressable>
            </View>

            {/* 目标类型列表 */}
            <View style={{ padding: 16, gap: 8 }}>
              {allowedTargets.map((type) => {
                const cfg = ENTRY_TYPES.find((t) => t.key === type);
                if (!cfg) return null;
                const active = convertTarget === type;
                return (
                  <Pressable
                    key={type}
                    style={[
                      styles.convertTypeItem,
                      active && { backgroundColor: cfg.color + '18', borderColor: cfg.color },
                    ]}
                    onPress={() => setConvertTarget(type)}
                  >
                    <FontAwesome
                      name={cfg.icon}
                      size={16}
                      color={active ? cfg.color : colors.textSecondary}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={[
                        { flex: 1, fontSize: 15, color: active ? cfg.color : colors.text },
                        active && { fontWeight: '600' },
                      ]}
                    >
                      {cfg.label}
                    </Text>
                    {active && <FontAwesome name="check" size={14} color={cfg.color} />}
                  </Pressable>
                );
              })}
            </View>

            {/* 科目选择 */}
            {convertTarget != null && (
              <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>
                  可选：指定新科目（不指定则沿用原科目）
                </Text>
                <Pressable
                  style={[styles.convertAccountRow, { borderColor: colors.border }]}
                  onPress={() => setCategoryPickerVisible(true)}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>分类科目</Text>
                  <Text style={{ color: categoryName ? colors.text : colors.textSecondary, fontSize: 14 }}>
                    {categoryName || '沿用原科目'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.convertAccountRow, { borderColor: colors.border }]}
                  onPress={() => setPaymentPickerVisible(true)}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>支付科目</Text>
                  <Text style={{ color: paymentName ? colors.text : colors.textSecondary, fontSize: 14 }}>
                    {paymentName || '沿用原科目'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* 确认按钮 */}
            <Pressable
              style={[
                styles.convertConfirmBtn,
                !convertTarget && { opacity: 0.4 },
              ]}
              disabled={!convertTarget || converting}
              onPress={handleConvert}
            >
              {converting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>确认转换</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {/* 分类科目选择 */}
    <AccountPicker
      visible={categoryPickerVisible}
      onClose={() => setCategoryPickerVisible(false)}
      onSelect={(acc) => {
        setConvertCategoryId(acc.id);
        setCategoryName(acc.name);
      }}
      selectedId={convertCategoryId}
      bookId={currentBook?.id}
    />

    {/* 支付科目选择 */}
    <AccountPicker
      visible={paymentPickerVisible}
      onClose={() => setPaymentPickerVisible(false)}
      onSelect={(acc) => {
        setConvertPaymentId(acc.id);
        setPaymentName(acc.name);
      }}
      selectedId={convertPaymentId}
      bookId={currentBook?.id}
      allowedTypes={['asset', 'liability']}
    />

    {/* Toast */}
    {toastMsg ? (
      <View style={styles.toast}>
        <Text style={styles.toastText}>{toastMsg}</Text>
      </View>
    ) : null}
    </>
  );
}

export default function LedgerScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const currentBook = useBookStore((s) => s.currentBook);
  const fetchBooks = useBookStore((s) => s.fetchBooks);
  const { entries, total, isLoading, filterType, fetchEntries, loadMore, setFilterType } =
    useEntryStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  // 桌面端 Modal 编辑/新建（null=关闭，'new'=新建，其他=编辑对应 entryId）
  const [editModalId, setEditModalId] = useState<string | null>(null);

  const doFetch = useCallback(() => {
    if (currentBook) {
      fetchEntries(currentBook.id);
    }
  }, [currentBook, fetchEntries]);

  useEffect(() => {
    fetchBooks();
  }, []);

  // 页面聚焦时刷新，并重置右侧详情面板
  useFocusEffect(
    useCallback(() => {
      setSelectedEntryId(null);
      doFetch();
    }, [doFetch])
  );

  // 切换筛选类型时刷新
  useEffect(() => {
    doFetch();
  }, [filterType]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await doFetch();
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (currentBook) loadMore(currentBook.id);
  };

  const handleEntryPress = (entry: EntryResponse) => {
    if (isDesktop) {
      setSelectedEntryId(entry.id);
    } else {
      router.push(`/entry/${entry.id}` as any);
    }
  };

  const groups = groupByDate(entries);

  const renderItem = ({ item }: { item: { date: string; items: EntryResponse[] } }) => (
    <View style={styles.group}>
      <Text style={[styles.dateHeader, { color: colors.textSecondary }]}>{item.date}</Text>
      {item.items.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onPress={() => handleEntryPress(entry)}
        />
      ))}
    </View>
  );

  const filterBar = (
    <View style={styles.tabs}>
      {FILTER_TABS.map((tab) => {
        const active = filterType === tab.key;
        return (
          <Pressable
            key={tab.key ?? 'all'}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => setFilterType(tab.key)}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const entryList = entries.length === 0 && !isLoading ? (
    <View style={styles.empty}>
      <FontAwesome name="book" size={48} color={colors.textSecondary} style={{ opacity: 0.3 }} />
      <Text style={[styles.emptyText, { color: colors.text }]}>暂无分录记录</Text>
      <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>记一笔账试试吧</Text>
    </View>
  ) : (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.date}
      renderItem={renderItem}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.3}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
      ListFooterComponent={
        isLoading && entries.length > 0 ? (
          <ActivityIndicator style={styles.footer} color={Colors.primary} />
        ) : null
      }
    />
  );

  const fab = (
    <Pressable
      style={[styles.fab, { backgroundColor: Colors.primary }]}
      onPress={() => isDesktop ? setEditModalId('new') : router.push('/entry/new' as any)}
    >
      <FontAwesome name="plus" size={22} color="#FFFFFF" />
    </Pressable>
  );

  // 编辑/新建 Modal 关闭后刷新
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const handleEditModalClose = () => {
    setEditModalId(null);
    doFetch();
    setDetailRefreshKey((k) => k + 1);
  };

  const editModal = (
    <Modal
      visible={editModalId !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setEditModalId(null)}
    >
      <Pressable
        style={styles.editModalOverlay}
        onPress={() => setEditModalId(null)}
      >
        <Pressable
          style={[styles.editModalContent, { backgroundColor: colors.background }]}
          onPress={(e) => e.stopPropagation()}
        >
          {editModalId !== null && (
            <NewEntryScreen
              editIdProp={editModalId === 'new' ? undefined : editModalId}
              onClose={handleEditModalClose}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (isDesktop) {
    return (
      <>
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.desktopList, { borderRightColor: colors.border, backgroundColor: colors.background }]}>
          {filterBar}
          {entryList}
          {fab}
        </View>
        <View style={[styles.desktopDetail, { backgroundColor: colors.background }]}>
          {selectedEntryId ? (
            <EntryDetailPane
              key={`${selectedEntryId}-${detailRefreshKey}`}
              entryId={selectedEntryId}
              colors={colors}
              onDeleted={() => {
                setSelectedEntryId(null);
                doFetch();
              }}
              onEdit={(id) => setEditModalId(id)}
            />
          ) : (
            <View style={styles.detailCenter}>
              <FontAwesome name="file-text-o" size={48} color={colors.textSecondary} style={{ opacity: 0.3 }} />
              <Text style={[styles.detailPlaceholder, { color: colors.textSecondary }]}>
                选择左侧分录查看详情
              </Text>
            </View>
          )}
        </View>
      </View>
      {editModal}
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {filterBar}
      {entryList}
      {fab}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 13,
    opacity: 0.6,
  },
  tabTextActive: {
    color: '#FFFFFF',
    opacity: 1,
    fontWeight: '600',
  },
  group: {
    marginBottom: 4,
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyHint: {
    fontSize: 13,
  },
  footer: {
    paddingVertical: 16,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  // Desktop master-detail
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopList: {
    width: 380,
    borderRightWidth: 1,
  },
  desktopDetail: {
    flex: 1,
  },
  detailCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  detailPlaceholder: {
    fontSize: 14,
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    padding: 24,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  detailActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 8,
  },
  detailCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  detailLabel: {
    fontSize: 14,
    width: 80,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  lineHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  lineHeaderCell: {
    fontSize: 12,
    fontWeight: '600',
  },
  lineRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineCell: {
    fontSize: 13,
  },
  lineAccount: {
    flex: 1,
  },
  lineAmount: {
    width: 80,
    textAlign: 'right',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalMsg: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  // Toast styles
  toast: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  // Edit Modal styles (desktop)
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModalContent: {
    width: '90%',
    maxWidth: 520,
    height: '85%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  // Convert Modal styles
  convertSheet: {
    width: '100%',
    borderRadius: 16,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  convertSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  convertTypeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  convertAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  convertConfirmBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});
