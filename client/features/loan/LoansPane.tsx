import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useLoanStore } from '@/stores/loanStore';
import { type AccountType } from '@/stores/accountStore';
import { accountService, type AccountTreeNode } from '@/services/accountService';
import { loanService, type LoanResponse, type RepaymentScheduleItem } from '@/services/loanService';
import RepaymentSchedule from '@/features/loan/RepaymentSchedule';
import AccountPicker from '@/features/entry/AccountPicker';
import { styles, budgetStyles } from '@/features/profile/styles';

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

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000); };

  const findAccountByCode = (nodes: AccountTreeNode[], code: string): AccountTreeNode | null => {
    for (const node of nodes) {
      if (node.code === code) return node;
      if (node.children?.length) { const found = findAccountByCode(node.children, code); if (found) return found; }
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
    } catch { showToast('加载贷款信息失败'); } finally { setLoading(false); }
  }, [loanId, currentBook]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRepay = async () => {
    if (!loan || !paymentAccount) return;
    setRepaying(true);
    try {
      const { data } = await loanService.repay(loan.id, { payment_account_id: paymentAccount.id, interest_account_id: interestAccount?.id });
      showToast(data.status === 'paid_off' ? '贷款已结清！' : `还款成功，剩余本金 ¥${data.remaining_principal.toFixed(2)}`);
      await fetchData();
    } catch (e: any) { showToast(e?.response?.data?.detail ?? '还款失败'); } finally { setRepaying(false); }
  };

  const confirmDelete = async () => {
    if (!loan) return;
    setShowDeleteConfirm(false);
    try { await loanService.deleteLoan(loan.id); onDeleted(); } catch (e: any) { showToast(e?.response?.data?.detail ?? '删除失败'); }
  };

  if (loading) return <View style={styles.acctCenter}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!loan) return <View style={styles.acctCenter}><Text>贷款不存在</Text></View>;

  const isActive = loan.status === 'active';
  const progress = loan.principal > 0 ? Math.round(((loan.principal - loan.remaining_principal) / loan.principal) * 100) : 100;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><FontAwesome name="chevron-left" size={18} color={colors.text} /></Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{loan.name}</Text>
        <Pressable onPress={() => setShowDeleteConfirm(true)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><FontAwesome name="trash-o" size={18} color={Colors.asset} /></Pressable>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
          {([
            ['贷款名称', loan.name], ['关联科目', loan.account_name], ['贷款本金', `¥ ${loan.principal.toLocaleString()}`],
            ['剩余本金', `¥ ${loan.remaining_principal.toLocaleString()}`, Colors.primary], ['年利率', `${loan.annual_rate}%`],
            ['还款方式', LOAN_METHOD_LABEL[loan.repayment_method] ?? loan.repayment_method], ['月供', `¥ ${loan.monthly_payment.toFixed(2)}`],
            ['利息总额', `¥ ${loan.total_interest.toFixed(2)}`, Colors.asset], ['还款期数', `${loan.total_months} 个月`],
            ['已还期数', `${loan.repaid_months} 期`], ['首次还款', loan.start_date],
            ['状态', isActive ? '还款中' : '已结清', isActive ? Colors.liability : colors.textSecondary],
          ] as [string, string, string?][]).map(([label, value, valueColor]) => (
            <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
              <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>还款进度 ({loan.repaid_months}/{loan.total_months}期)</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{progress}%</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
            <View style={{ height: '100%', borderRadius: 4, backgroundColor: progress >= 100 ? Colors.liability : Colors.primary, width: `${Math.min(progress, 100)}%` }} />
          </View>
        </View>

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
              onPress={handleRepay} disabled={repaying || !paymentAccount}
            >
              {repaying ? <ActivityIndicator size="small" color="#FFF" /> : (<><FontAwesome name="check" size={14} color="#FFF" style={{ marginRight: 6 }} /><Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>记录一期还款</Text></>)}
            </Pressable>
          </View>
        )}

        <RepaymentSchedule schedule={schedule} />
        <View style={{ height: 40 }} />
      </ScrollView>

      <AccountPicker
        visible={pickerMode !== null}
        onClose={() => setPickerMode(null)}
        onSelect={(acc) => { if (pickerMode === 'payment') setPaymentAccount(acc); else setInterestAccount(acc); setPickerMode(null); }}
        allowedTypes={pickerMode === 'payment' ? (['asset'] as AccountType[]) : (['expense'] as AccountType[])}
        selectedId={pickerMode === 'payment' ? paymentAccount?.id : interestAccount?.id}
        bookId={currentBook?.id}
      />

      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除贷款</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>确定要删除「{loan.name}」吗？</Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowDeleteConfirm(false)}><Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text></Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={confirmDelete}><Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text></Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function LoansPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { loans, summary, isLoading, filterStatus, fetchLoans, fetchSummary, setFilterStatus } = useLoanStore();
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  useEffect(() => { if (currentBook) { fetchLoans(currentBook.id); fetchSummary(currentBook.id); } }, [currentBook?.id, filterStatus]);

  const handleLoanPress = (loan: LoanResponse) => { setSelectedLoanId(loan.id); };
  const handleStatusChange = (status: string | null) => { setFilterStatus(status); };
  const handleBackFromDetail = () => { setSelectedLoanId(null); };
  const handleLoanDeleted = () => { setSelectedLoanId(null); if (currentBook) { fetchLoans(currentBook.id); fetchSummary(currentBook.id); } };

  if (selectedLoanId) return <LoanDetailInline loanId={selectedLoanId} onBack={handleBackFromDetail} onDeleted={handleLoanDeleted} />;
  if (isLoading && loans.length === 0) return <View style={styles.acctCenter}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>贷款管理</Text>
        <Pressable style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]} onPress={() => router.push('/loans/new' as any)}>
          <FontAwesome name="plus" size={12} color="#FFF" /><Text style={styles.saveBtnText}>新建贷款</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {summary && (
          <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>贷款总额</Text><Text style={{ fontSize: 16, fontWeight: '700' }}>¥{summary.total_principal.toLocaleString()}</Text></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>剩余本金</Text><Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>¥{summary.total_remaining.toLocaleString()}</Text></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>已付利息</Text><Text style={{ fontSize: 16, fontWeight: '700', color: Colors.asset }}>¥{summary.total_interest_paid.toLocaleString()}</Text></View>
            </View>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>共 {summary.loan_count} 笔贷款，{summary.active_count} 笔还款中</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
          {LOAN_STATUS_TABS.map((tab) => {
            const active = filterStatus === tab.key;
            return (
              <Pressable key={tab.key ?? 'all'} style={[styles.acctTab, active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary }]} onPress={() => handleStatusChange(tab.key)}>
                <Text style={[styles.acctTabText, { color: active ? Colors.primary : colors.textSecondary }, active && { fontWeight: '600' }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loans.length === 0 ? (
          <View style={styles.acctEmpty}><FontAwesome name="credit-card" size={40} color={colors.textSecondary} /><Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无贷款</Text></View>
        ) : (
          loans.map((loan) => (
            <Pressable key={loan.id} style={[styles.acctRow, { paddingLeft: 16 }]} onPress={() => handleLoanPress(loan)}>
              <View style={[styles.iconCircle, { backgroundColor: Colors.liability + '15' }]}><FontAwesome name="credit-card" size={14} color={Colors.liability} /></View>
              <View style={styles.acctRowContent}>
                <Text style={styles.acctRowName}>{loan.name}</Text>
                <Text style={[styles.acctRowCode, { color: colors.textSecondary }]}>{LOAN_METHOD_LABEL[loan.repayment_method]} · {loan.annual_rate}%</Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>¥{loan.remaining_principal.toLocaleString()}</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary }}>{loan.repaid_months}/{loan.total_months}期</Text>
              </View>
              <View style={[styles.directionBadge, { backgroundColor: loan.status === 'paid_off' ? colors.textSecondary + '15' : Colors.liability + '15' }]}>
                <Text style={[styles.directionText, { color: loan.status === 'paid_off' ? colors.textSecondary : Colors.liability }]}>{loan.status === 'paid_off' ? '结清' : '还款中'}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
