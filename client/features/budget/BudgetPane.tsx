import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { budgetService, type BudgetResponse } from '@/services/budgetService';
import { type AccountType } from '@/stores/accountStore';
import { type AccountTreeNode } from '@/services/accountService';
import BudgetCard from '@/features/budget/BudgetCard';
import AccountPicker from '@/features/entry/AccountPicker';
import { styles, budgetStyles } from '@/features/profile/styles';

export default function BudgetPane() {
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
