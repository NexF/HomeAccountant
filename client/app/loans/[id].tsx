import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  loanService,
  type LoanResponse,
  type RepaymentScheduleItem,
} from '@/services/loanService';
import RepaymentSchedule from '@/components/loans/RepaymentSchedule';
import AccountPicker from '@/components/entry/AccountPicker';
import { accountService, type AccountTreeNode } from '@/services/accountService';
import type { AccountType } from '@/stores/accountStore';

const METHOD_LABEL: Record<string, string> = {
  equal_installment: '等额本息',
  equal_principal: '等额本金',
};

function InfoRow({
  label,
  value,
  colors,
  valueColor,
}: {
  label: string;
  value: string;
  colors: any;
  valueColor?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor ?? colors.text }]}>{value}</Text>
    </View>
  );
}

export default function LoanDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentBook = useBookStore((s) => s.currentBook);

  const [loan, setLoan] = useState<LoanResponse | null>(null);
  const [schedule, setSchedule] = useState<RepaymentScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [repaying, setRepaying] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  // 还款相关
  const [paymentAccount, setPaymentAccount] = useState<AccountTreeNode | null>(null);
  const [interestAccount, setInterestAccount] = useState<AccountTreeNode | null>(null);
  const [pickerMode, setPickerMode] = useState<'payment' | 'interest' | null>(null);

  // 从科目树中递归查找 code=5013 的利息支出科目
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

  const fetchData = useCallback(async () => {
    if (!id || !currentBook) return;
    setLoading(true);
    try {
      const [loanRes, scheduleRes, treeRes] = await Promise.all([
        loanService.getLoan(id),
        loanService.getSchedule(id),
        accountService.getAccountTree(currentBook.id),
      ]);
      setLoan(loanRes.data);
      setSchedule(scheduleRes.data);

      // 默认利息科目：利息支出 5013
      if (!interestAccount) {
        const expenseNodes = treeRes.data.expense ?? [];
        const found = findAccountByCode(expenseNodes, '5013');
        if (found) setInterestAccount(found);
      }
    } catch {
      showToast('错误', '加载贷款信息失败');
    } finally {
      setLoading(false);
    }
  }, [id, currentBook]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRepay = async () => {
    if (!loan || !paymentAccount) return;
    setRepaying(true);
    try {
      const { data } = await loanService.repay(loan.id, {
        payment_account_id: paymentAccount.id,
        interest_account_id: interestAccount?.id,
      });
      const msg = data.status === 'paid_off'
        ? '贷款已结清！'
        : `还款成功，剩余本金 ¥${data.remaining_principal.toFixed(2)}`;
      showToast('成功', msg);
      await fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '还款失败';
      showToast('错误', msg);
    } finally {
      setRepaying(false);
    }
  };

  const handleDelete = () => {
    if (!loan) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!loan) return;
    setShowDeleteConfirm(false);
    try {
      await loanService.deleteLoan(loan.id);
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? '删除失败';
      showToast('错误', msg);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!loan) {
    return (
      <View style={styles.center}>
        <Text>贷款不存在</Text>
      </View>
    );
  }

  const isActive = loan.status === 'active';
  const progress = loan.principal > 0
    ? Math.round(((loan.principal - loan.remaining_principal) / loan.principal) * 100)
    : 100;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{loan.name}</Text>
        <Pressable onPress={handleDelete} style={styles.headerBtn}>
          <FontAwesome name="trash-o" size={18} color={Colors.asset} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll}>
        {/* 基本信息 */}
        <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
          <InfoRow label="贷款名称" value={loan.name} colors={colors} />
          <InfoRow label="关联科目" value={loan.account_name} colors={colors} />
          <InfoRow label="贷款本金" value={`¥ ${loan.principal.toLocaleString()}`} colors={colors} />
          <InfoRow
            label="剩余本金"
            value={`¥ ${loan.remaining_principal.toLocaleString()}`}
            colors={colors}
            valueColor={Colors.primary}
          />
          <InfoRow label="年利率" value={`${loan.annual_rate}%`} colors={colors} />
          <InfoRow
            label="还款方式"
            value={METHOD_LABEL[loan.repayment_method] ?? loan.repayment_method}
            colors={colors}
          />
          <InfoRow label="月供" value={`¥ ${loan.monthly_payment.toFixed(2)}`} colors={colors} />
          <InfoRow
            label="利息总额"
            value={`¥ ${loan.total_interest.toFixed(2)}`}
            colors={colors}
            valueColor={Colors.asset}
          />
          <InfoRow label="还款期数" value={`${loan.total_months} 个月`} colors={colors} />
          <InfoRow label="已还期数" value={`${loan.repaid_months} 期`} colors={colors} />
          <InfoRow label="首次还款" value={loan.start_date} colors={colors} />
          <InfoRow
            label="状态"
            value={isActive ? '还款中' : '已结清'}
            colors={colors}
            valueColor={isActive ? Colors.liability : colors.textSecondary}
          />
        </View>

        {/* 还款进度 */}
        <View style={[styles.progressCard, { backgroundColor: colors.card }]}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              还款进度 ({loan.repaid_months}/{loan.total_months}期)
            </Text>
            <Text style={[styles.progressValue, { color: colors.text }]}>{progress}%</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressBar,
                {
                  backgroundColor: progress >= 100 ? Colors.liability : Colors.primary,
                  width: `${Math.min(progress, 100)}%`,
                },
              ]}
            />
          </View>
        </View>

        {/* 还款操作 */}
        {isActive && (
          <View style={[styles.repaySection, { backgroundColor: colors.card }]}>
            <Text style={[styles.repaySectionTitle, { color: colors.text }]}>记录还款</Text>

            <Pressable
              style={[styles.accountPicker, { borderColor: colors.border }]}
              onPress={() => setPickerMode('payment')}
            >
              <Text style={[styles.accountPickerLabel, { color: colors.textSecondary }]}>还款账户</Text>
              <View style={styles.accountPickerValue}>
                <Text style={{ color: paymentAccount ? colors.text : colors.textSecondary, flex: 1 }}>
                  {paymentAccount ? paymentAccount.name : '请选择资产账户'}
                </Text>
                <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
              </View>
            </Pressable>

            <Pressable
              style={[styles.accountPicker, { borderColor: colors.border }]}
              onPress={() => setPickerMode('interest')}
            >
              <Text style={[styles.accountPickerLabel, { color: colors.textSecondary }]}>利息费用科目</Text>
              <View style={styles.accountPickerValue}>
                <Text style={{ color: interestAccount ? colors.text : colors.textSecondary, flex: 1 }}>
                  {interestAccount ? interestAccount.name : '点击选择费用科目'}
                </Text>
                <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
              </View>
            </Pressable>

            <Pressable
              style={[
                styles.repayBtn,
                { backgroundColor: Colors.primary, opacity: repaying || !paymentAccount ? 0.6 : 1 },
              ]}
              onPress={handleRepay}
              disabled={repaying || !paymentAccount}
            >
              {repaying ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <FontAwesome name="check" size={14} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.repayBtnText}>记录一期还款</Text>
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

      {/* 删除确认 Modal */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>删除贷款</Text>
            <Text style={[styles.modalMsg, { color: colors.textSecondary }]}>
              确定要删除「{loan?.name}」吗？
            </Text>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalBtn, { backgroundColor: colors.border }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: '#EF4444' }]} onPress={confirmDelete}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast 提示 */}
      {toastMsg ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
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
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  infoCard: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressCard: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
  },
  progressValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  repaySection: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
  },
  repaySectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  accountPicker: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  accountPickerLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  accountPickerValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  repayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  repayBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  toastText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: 300,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalMsg: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
});
