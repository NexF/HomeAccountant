import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  entryService,
  ALLOWED_CONVERSIONS,
  type EntryDetailResponse,
  type EntryType,
} from '@/services/entryService';
import { AccountPicker } from '@/features/entry';
import { ENTRY_TYPES, type EntryTypeConfig } from '@/features/entry/EntryTypeTab';
import { useBookStore } from '@/stores/bookStore';

const TYPE_LABELS: Record<string, string> = {
  expense: '费用',
  income: '收入',
  asset_purchase: '购买资产',
  borrow: '借入',
  repay: '还款',
  transfer: '转账',
  manual: '手动分录',
};

export default function EntryDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [entry, setEntry] = useState<EntryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // 转换类型 Modal 状态
  const [convertVisible, setConvertVisible] = useState(false);
  const [convertTarget, setConvertTarget] = useState<EntryType | null>(null);
  const [convertCategoryId, setConvertCategoryId] = useState<string | undefined>();
  const [convertPaymentId, setConvertPaymentId] = useState<string | undefined>();
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [converting, setConverting] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [paymentName, setPaymentName] = useState('');
  const currentBook = useBookStore((s) => s.currentBook);

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  const fetchDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const { data } = await entryService.getEntry(id);
      setEntry(data);
    } catch {
      showToast('错误', '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  // 编辑返回后自动刷新数据
  useFocusEffect(
    useCallback(() => {
      fetchDetail();
    }, [id])
  );

  const handleDelete = () => {
    if (!entry) return;
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!entry) return;
    try {
      await entryService.deleteEntry(entry.id);
      setShowDeleteModal(false);
      router.back();
    } catch {
      setShowDeleteModal(false);
      showToast('错误', '删除失败');
    }
  };

  // 转换类型相关
  const canConvert = !!ALLOWED_CONVERSIONS[entry?.entry_type as EntryType]?.length;
  const allowedTargets = entry ? ALLOWED_CONVERSIONS[entry.entry_type as EntryType] ?? [] : [];

  const getTargetConfig = (type: EntryType): EntryTypeConfig | undefined =>
    ENTRY_TYPES.find((t) => t.key === type);

  const openConvertModal = () => {
    setConvertTarget(null);
    setConvertCategoryId(undefined);
    setConvertPaymentId(undefined);
    setCategoryName('');
    setPaymentName('');
    setConvertVisible(true);
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
      setConvertVisible(false);
      showToast('成功', `已转换为${TYPE_LABELS[convertTarget] ?? convertTarget}`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? '转换失败';
      showToast('错误', msg);
    } finally {
      setConverting(false);
    }
  };

  /** 判断当前选中的目标类型是否需要补充选科目 */
  const needsAccountPick = convertTarget != null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.loadingContainer}>
        <Text>分录不存在</Text>
      </View>
    );
  }

  const typeLabel = TYPE_LABELS[entry.entry_type] ?? entry.entry_type;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>分录详情</Text>
        <View style={styles.headerActions}>
          {canConvert && (
            <Pressable disabled style={[styles.headerBtn, { opacity: 0.3 }]}>
              <FontAwesome name="exchange" size={16} color={Colors.neutral} />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push(`/entry/new?editId=${entry.id}` as any)}
            style={styles.headerBtn}
          >
            <FontAwesome name="pencil" size={18} color={Colors.primary} />
          </Pressable>
          <Pressable onPress={handleDelete} style={styles.headerBtn}>
            <FontAwesome name="trash" size={18} color={Colors.asset} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.body}>
        {/* 基本信息 */}
        <View style={[styles.section, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>类型</Text>
            <Text style={styles.value}>{typeLabel}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>日期</Text>
            <Text style={styles.value}>{entry.entry_date}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>摘要</Text>
            <Text style={styles.value}>{entry.description || '无'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>备注</Text>
            <Text style={styles.value}>{entry.note || '无'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>来源</Text>
            <Text style={styles.value}>{entry.source}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>平衡</Text>
            <Text style={[styles.value, { color: entry.is_balanced ? Colors.liability : Colors.asset }]}>
              {entry.is_balanced ? '是' : '否'}
            </Text>
          </View>
        </View>

        {/* 借贷明细 */}
        <View style={styles.linesSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>借贷明细</Text>
          <View style={[styles.linesCard, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
            {/* Header Row */}
            <View style={[styles.lineRow, styles.lineHeaderRow]}>
              <Text style={[styles.lineAccount, styles.lineHeaderText, { color: colors.textSecondary }]}>科目</Text>
              <Text style={[styles.lineAmount, styles.lineHeaderText, { color: colors.textSecondary }]}>借方</Text>
              <Text style={[styles.lineAmount, styles.lineHeaderText, { color: colors.textSecondary }]}>贷方</Text>
            </View>
            {entry.lines.map((line, idx) => (
              <View key={line.id} style={[styles.lineRow, idx < entry.lines.length - 1 && styles.lineRowBorder]}>
                <Text style={styles.lineAccount} numberOfLines={1}>
                  {line.account_name || line.account_code || line.account_id.slice(0, 8)}
                </Text>
                <Text
                  style={[
                    styles.lineAmount,
                    { color: Number(line.debit_amount) > 0 ? Colors.asset : colors.textSecondary },
                  ]}
                >
                  {Number(line.debit_amount) > 0
                    ? `¥${Number(line.debit_amount).toLocaleString()}`
                    : '-'}
                </Text>
                <Text
                  style={[
                    styles.lineAmount,
                    { color: Number(line.credit_amount) > 0 ? Colors.liability : colors.textSecondary },
                  ]}
                >
                  {Number(line.credit_amount) > 0
                    ? `¥${Number(line.credit_amount).toLocaleString()}`
                    : '-'}
                </Text>
              </View>
            ))}
            {/* Total Row */}
            <View style={[styles.lineRow, styles.totalRow]}>
              <Text style={[styles.lineAccount, styles.totalText]}>合计</Text>
              <Text style={[styles.lineAmount, styles.totalText, { color: Colors.asset }]}>
                ¥{entry.lines.reduce((s, l) => s + Number(l.debit_amount), 0).toLocaleString()}
              </Text>
              <Text style={[styles.lineAmount, styles.totalText, { color: Colors.liability }]}>
                ¥{entry.lines.reduce((s, l) => s + Number(l.credit_amount), 0).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* 时间信息 */}
        <View style={[styles.section, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>创建时间</Text>
            <Text style={[styles.value, { fontSize: 13, color: colors.textSecondary }]}>
              {new Date(entry.created_at).toLocaleString()}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>更新时间</Text>
            <Text style={[styles.value, { fontSize: 13, color: colors.textSecondary }]}>
              {new Date(entry.updated_at).toLocaleString()}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 转换类型 Modal */}
      {convertVisible && (
        <ConvertModal
          visible={convertVisible}
          onClose={() => setConvertVisible(false)}
          allowedTargets={allowedTargets}
          convertTarget={convertTarget}
          onSelectTarget={setConvertTarget}
          categoryName={categoryName}
          paymentName={paymentName}
          onPickCategory={() => setCategoryPickerVisible(true)}
          onPickPayment={() => setPaymentPickerVisible(true)}
          converting={converting}
          onConvert={handleConvert}
          needsAccountPick={needsAccountPick}
          colorScheme={colorScheme}
        />
      )}

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

      {/* 删除确认 Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <Pressable
          style={deleteModalStyles.overlay}
          onPress={() => setShowDeleteModal(false)}
        >
          <View style={[deleteModalStyles.card, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
            <Text style={[deleteModalStyles.title, { color: colors.text }]}>删除分录</Text>
            <Text style={[deleteModalStyles.msg, { color: colors.textSecondary }]}>
              确定要删除该分录吗？删除后无法恢复。
            </Text>
            <View style={deleteModalStyles.btns}>
              <Pressable
                style={[deleteModalStyles.btn, { backgroundColor: colors.background }]}
                onPress={() => setShowDeleteModal(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[deleteModalStyles.btn, { backgroundColor: '#EF4444' }]}
                onPress={confirmDelete}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View style={deleteModalStyles.toast}>
          <Text style={deleteModalStyles.toastText}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 转换类型 Modal 子组件 */
function ConvertModal({
  visible,
  onClose,
  allowedTargets,
  convertTarget,
  onSelectTarget,
  categoryName,
  paymentName,
  onPickCategory,
  onPickPayment,
  converting,
  onConvert,
  needsAccountPick,
  colorScheme,
}: {
  visible: boolean;
  onClose: () => void;
  allowedTargets: EntryType[];
  convertTarget: EntryType | null;
  onSelectTarget: (t: EntryType) => void;
  categoryName: string;
  paymentName: string;
  onPickCategory: () => void;
  onPickPayment: () => void;
  converting: boolean;
  onConvert: () => void;
  needsAccountPick: boolean;
  colorScheme: 'light' | 'dark';
}) {
  const colors = Colors[colorScheme];
  const cardBg = colorScheme === 'dark' ? Colors.dark.card : Colors.light.card;

  const getTargetConfig = (type: EntryType): EntryTypeConfig | undefined =>
    ENTRY_TYPES.find((t) => t.key === type);

  const modalContent = (
    <View style={[convertStyles.sheet, { backgroundColor: cardBg }]}>
      <View style={convertStyles.sheetHeader}>
        <Text style={convertStyles.sheetTitle}>转换分录类型</Text>
        <Pressable onPress={onClose} style={convertStyles.closeBtn}>
          <FontAwesome name="close" size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* 目标类型列表 */}
      <View style={convertStyles.typeList}>
        {allowedTargets.map((type) => {
          const cfg = getTargetConfig(type);
          if (!cfg) return null;
          const active = convertTarget === type;
          return (
            <Pressable
              key={type}
              style={[
                convertStyles.typeItem,
                active && { backgroundColor: cfg.color + '18', borderColor: cfg.color },
              ]}
              onPress={() => onSelectTarget(type)}
            >
              <FontAwesome
                name={cfg.icon}
                size={16}
                color={active ? cfg.color : colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              <Text
                style={[
                  convertStyles.typeLabel,
                  { color: active ? cfg.color : colors.text },
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

      {/* 科目选择（当选中目标类型后展示） */}
      {needsAccountPick && (
        <View style={convertStyles.accountSection}>
          <Text style={[convertStyles.accountHint, { color: colors.textSecondary }]}>
            可选：指定新科目（不指定则沿用原科目）
          </Text>
          <Pressable
            style={[convertStyles.accountRow, { borderColor: colors.border }]}
            onPress={onPickCategory}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>分类科目</Text>
            <Text style={{ color: categoryName ? colors.text : colors.textSecondary, fontSize: 14 }}>
              {categoryName || '沿用原科目'}
            </Text>
          </Pressable>
          <Pressable
            style={[convertStyles.accountRow, { borderColor: colors.border }]}
            onPress={onPickPayment}
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
          convertStyles.confirmBtn,
          !convertTarget && { opacity: 0.4 },
        ]}
        disabled={!convertTarget || converting}
        onPress={onConvert}
      >
        {converting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={convertStyles.confirmText}>确认转换</Text>
        )}
      </Pressable>
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <Pressable style={convertStyles.overlay} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={convertStyles.webSheet}>
          {modalContent}
        </Pressable>
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={convertStyles.overlay} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()}>
          {modalContent}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const convertStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    ...(Platform.OS === 'web'
      ? ({
          position: 'fixed' as any,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          justifyContent: 'center',
          alignItems: 'center',
        } as any)
      : {}),
  },
  webSheet: {
    width: '90%',
    maxWidth: 420,
    maxHeight: '80%',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    ...(Platform.OS === 'web' ? { borderRadius: 16 } : {}),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeList: {
    padding: 16,
    gap: 8,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeLabel: {
    flex: 1,
    fontSize: 15,
  },
  accountSection: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  accountHint: {
    fontSize: 12,
    marginBottom: 4,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  confirmBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 52,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    flex: 1,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  label: {
    fontSize: 14,
    width: 80,
  },
  value: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  linesSection: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  linesCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lineHeaderRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  lineHeaderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  lineRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  lineAccount: {
    flex: 2,
    fontSize: 14,
  },
  lineAmount: {
    flex: 1,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  totalText: {
    fontWeight: '600',
  },
});

const deleteModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
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
    marginBottom: 8,
  },
  msg: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
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
});
