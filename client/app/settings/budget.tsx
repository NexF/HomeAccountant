import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { budgetService, type BudgetResponse } from '@/services/budgetService';
import AccountPicker from '@/features/entry/AccountPicker';
import type { AccountTreeNode } from '@/services/accountService';
import type { AccountType } from '@/stores/accountStore';
import BudgetCard from '@/features/budget/BudgetCard';

const STATUS_COLORS: Record<string, string> = {
  normal: Colors.asset,
  warning: '#F59E0B',
  exceeded: '#EF4444',
  not_set: '#9CA3AF',
};

export default function BudgetSettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { isDesktop } = useBreakpoint();

  const [loading, setLoading] = useState(true);
  const [budgets, setBudgets] = useState<BudgetResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');

  // 新建/编辑 Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetResponse | null>(null);
  const [modalAmount, setModalAmount] = useState('');
  const [modalThreshold, setModalThreshold] = useState('80');
  const [modalAccount, setModalAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isTotalBudget, setIsTotalBudget] = useState(false);

  // 删除确认 Modal
  const [deleteTarget, setDeleteTarget] = useState<BudgetResponse | null>(null);

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      const { Alert } = require('react-native');
      Alert.alert(title, message);
    }
  };

  const fetchBudgets = useCallback(async () => {
    if (!currentBook) return;
    try {
      const { data } = await budgetService.listBudgets(currentBook.id);
      setBudgets(data);
    } catch {
      showToast('错误', '加载预算失败');
    } finally {
      setLoading(false);
    }
  }, [currentBook]);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  const totalBudget = budgets.find((b) => b.account_id === null);
  const categoryBudgets = budgets.filter((b) => b.account_id !== null);

  // 打开新建/编辑 Modal
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
    setModalAccount(null); // 编辑时不可改科目
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!currentBook) return;
    const amount = parseFloat(modalAmount);
    if (!amount || amount <= 0) {
      showToast('提示', '请输入有效的预算金额');
      return;
    }
    if (!editingBudget && !isTotalBudget && !modalAccount) {
      showToast('提示', '请选择费用科目');
      return;
    }
    const threshold = parseInt(modalThreshold) / 100;

    setSaving(true);
    try {
      if (editingBudget) {
        await budgetService.updateBudget(editingBudget.id, {
          amount,
          alert_threshold: threshold,
        });
      } else {
        await budgetService.createBudget(currentBook.id, {
          account_id: modalAccount?.id ?? null,
          amount,
          alert_threshold: threshold,
        });
      }
      setModalVisible(false);
      await fetchBudgets();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '保存失败';
      showToast('错误', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await budgetService.deleteBudget(deleteTarget.id);
      setDeleteTarget(null);
      await fetchBudgets();
    } catch (e: any) {
      showToast('错误', e?.response?.data?.detail ?? '删除失败');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const totalStatusColor = totalBudget
    ? STATUS_COLORS[totalBudget.status] ?? colors.textSecondary
    : '#9CA3AF';
  const totalPct = totalBudget ? Math.min(totalBudget.usage_rate, 1) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      {!isDesktop && (
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <FontAwesome name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>预算设置</Text>
          <View style={styles.headerBtn} />
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 总预算 */}
        {!totalBudget && (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>月度总预算</Text>
            <Pressable onPress={() => openCreateModal(true)}>
              <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>+ 设置</Text>
            </Pressable>
          </View>
        )}

        {totalBudget ? (
          <Pressable
            style={[styles.totalCard, { backgroundColor: colors.card }]}
            onPress={() => openEditModal(totalBudget)}
            onLongPress={() => setDeleteTarget(totalBudget)}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 10 }}>
              月度总预算
            </Text>
            <View style={styles.totalRow}>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
                  预算额度
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
                  ¥{totalBudget.amount.toLocaleString()}
                </Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
                  本月已用
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: totalStatusColor }}>
                  ¥{totalBudget.used_amount.toLocaleString()}
                </Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: totalStatusColor }}>
                {Math.round(totalBudget.usage_rate * 100)}%
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View
                style={[styles.bar, { width: `${totalPct}%`, backgroundColor: totalStatusColor }]}
              />
            </View>
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6 }}>
              提醒阈值：{Math.round(totalBudget.alert_threshold * 100)}% · 点击编辑 · 长按删除
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              尚未设置总预算
            </Text>
          </View>
        )}

        {/* 分类预算 */}
        <View style={[styles.sectionHeader, { marginTop: 20 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>分类预算</Text>
          <Pressable onPress={() => openCreateModal(false)}>
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>+ 添加</Text>
          </Pressable>
        </View>

        {categoryBudgets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              尚未设置分类预算，点击右上角添加
            </Text>
          </View>
        ) : (
          categoryBudgets.map((b) => (
            <BudgetCard
              key={b.id}
              budget={b}
              onPress={() => openEditModal(b)}
              onLongPress={() => setDeleteTarget(b)}
            />
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 新建/编辑 Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingBudget ? '编辑预算' : '添加预算'}
            </Text>

            {/* 科目选择（仅新建分类预算时） */}
            {!editingBudget && !isTotalBudget && (
              <Pressable
                style={[styles.modalField, { borderColor: colors.border }]}
                onPress={() => {
                  setModalVisible(false);
                  setTimeout(() => setPickerVisible(true), 300);
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>费用科目</Text>
                <Text style={{ color: modalAccount ? colors.text : colors.textSecondary, fontSize: 14 }}>
                  {modalAccount?.name ?? '请选择费用科目'}
                </Text>
              </Pressable>
            )}

            {editingBudget && (
              <View style={[styles.modalField, { borderColor: colors.border }]}>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>科目</Text>
                <Text style={{ color: colors.text, fontSize: 14 }}>
                  {editingBudget.account_name ?? '总预算'}
                </Text>
              </View>
            )}

            <View style={[styles.modalField, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>预算金额</Text>
              <TextInput
                style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', flex: 1 }}
                value={modalAmount}
                onChangeText={setModalAmount}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={[styles.modalField, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>提醒阈值 (%)</Text>
              <TextInput
                style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', flex: 1 }}
                value={modalThreshold}
                onChangeText={setModalThreshold}
                keyboardType="numeric"
                placeholder="80"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: Colors.primary }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: '#FFF', fontWeight: '600' }}>保存</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setDeleteTarget(null)}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>删除预算</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{deleteTarget?.account_name ?? '总预算'}」吗？
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleDelete}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* AccountPicker */}
      <AccountPicker
        visible={pickerVisible}
        onClose={() => {
          setPickerVisible(false);
          setTimeout(() => setModalVisible(true), 300);
        }}
        onSelect={(acc) => {
          setModalAccount(acc);
          setPickerVisible(false);
          setTimeout(() => setModalVisible(true), 300);
        }}
        allowedTypes={['expense'] as AccountType[]}
        selectedId={modalAccount?.id}
        bookId={currentBook?.id}
      />

      {/* Toast */}
      {toastMsg ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 52,
    paddingBottom: 8,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  totalCard: { borderRadius: 12, padding: 16, marginBottom: 8 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  emptyCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 8,
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: { width: '85%', maxWidth: 420, borderRadius: 14, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  modalField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  // Toast
  toast: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 999,
  },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
