import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { loanService } from '@/services/loanService';
import AccountPicker from '@/features/entry/AccountPicker';
import type { AccountTreeNode } from '@/services/accountService';
import type { AccountType } from '@/stores/accountStore';
import { useBreakpoint } from '@/hooks/useBreakpoint';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcMonthlyPayment(principal: number, rate: number, months: number, method: string) {
  if (months <= 0 || principal <= 0) return 0;
  const r = rate / 1200;
  if (method === 'equal_installment') {
    if (r === 0) return principal / months;
    const factor = Math.pow(1 + r, months);
    return (principal * r * factor) / (factor - 1);
  }
  // equal_principal first payment
  return principal / months + principal * r;
}

function calcTotalInterest(principal: number, rate: number, months: number, method: string) {
  if (months <= 0 || principal <= 0) return 0;
  const r = rate / 1200;
  if (method === 'equal_installment') {
    if (r === 0) return 0;
    const factor = Math.pow(1 + r, months);
    const mp = (principal * r * factor) / (factor - 1);
    return mp * months - principal;
  }
  // equal_principal
  let total = 0;
  const pp = principal / months;
  let remaining = principal;
  for (let i = 0; i < months; i++) {
    total += remaining * r;
    remaining -= pp;
  }
  return total;
}

export default function NewLoanScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { isDesktop } = useBreakpoint();

  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [totalMonths, setTotalMonths] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [method, setMethod] = useState<'equal_installment' | 'equal_principal'>('equal_installment');
  const [account, setAccount] = useState<AccountTreeNode | null>(null);
  const [depositAccount, setDepositAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [depositPickerVisible, setDepositPickerVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const preview = useMemo(() => {
    const p = parseFloat(principal) || 0;
    const r = parseFloat(annualRate) || 0;
    const m = parseInt(totalMonths) || 0;
    if (p <= 0 || m <= 0) return null;
    const mp = calcMonthlyPayment(p, r, m, method);
    const ti = calcTotalInterest(p, r, m, method);
    return {
      monthlyPayment: mp.toFixed(2),
      totalInterest: ti.toFixed(2),
      totalRepayment: (p + ti).toFixed(2),
    };
  }, [principal, annualRate, totalMonths, method]);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSubmit = async () => {
    if (!currentBook) { showAlert('提示', '请先选择账本'); return; }
    if (!name.trim()) { showAlert('提示', '请输入贷款名称'); return; }
    if (!account) { showAlert('提示', '请选择负债科目'); return; }
    const p = parseFloat(principal);
    if (!p || p <= 0) { showAlert('提示', '请输入有效的贷款金额'); return; }
    const r = parseFloat(annualRate);
    if (isNaN(r) || r < 0) { showAlert('提示', '请输入有效的年利率'); return; }
    const m = parseInt(totalMonths);
    if (!m || m <= 0) { showAlert('提示', '请输入有效的还款期数'); return; }

    setSubmitting(true);
    try {
      await loanService.createLoan(currentBook.id, {
        name: name.trim(),
        account_id: account.id,
        principal: p,
        annual_rate: r,
        total_months: m,
        repayment_method: method,
        start_date: startDate,
        deposit_account_id: depositAccount?.id,
      });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '创建失败';
      showAlert('错误', typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={isDesktop ? styles.desktopOverlay : styles.container}>
      <View style={isDesktop ? [styles.desktopModal, { backgroundColor: colors.background }] : styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <FontAwesome name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>新建贷款</Text>
          <Pressable
            onPress={handleSubmit}
            style={[styles.submitBtn, { backgroundColor: Colors.primary, opacity: submitting ? 0.6 : 1 }]}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.submitText}>保存</Text>
            )}
          </Pressable>
        </View>

        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          {/* 贷款名称 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>贷款名称</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="如：房贷、车贷"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* 负债科目 */}
          <Pressable
            style={[styles.field, { borderColor: colors.border }]}
            onPress={() => setPickerVisible(true)}
          >
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>负债科目</Text>
            <View style={styles.fieldValue}>
              {account ? (
                <Text style={[styles.fieldText, { color: colors.text }]}>{account.name}</Text>
              ) : (
                <Text style={[styles.fieldText, { color: colors.textSecondary }]}>请选择负债科目</Text>
              )}
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
            </View>
          </Pressable>

          {/* 放款账户 */}
          <Pressable
            style={[styles.field, { borderColor: colors.border }]}
            onPress={() => setDepositPickerVisible(true)}
          >
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>放款到账户（可选）</Text>
            <View style={styles.fieldValue}>
              {depositAccount ? (
                <Text style={[styles.fieldText, { color: colors.text }]}>{depositAccount.name}</Text>
              ) : (
                <Text style={[styles.fieldText, { color: colors.textSecondary }]}>选择资产账户，自动生成入账分录</Text>
              )}
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
            </View>
          </Pressable>

          {/* 贷款金额 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>贷款金额 (¥)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={principal}
              onChangeText={setPrincipal}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>

          {/* 年利率 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>年利率 (%)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={annualRate}
              onChangeText={setAnnualRate}
              placeholder="4.9"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>

          {/* 还款期数 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款期数 (月)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={totalMonths}
              onChangeText={setTotalMonths}
              placeholder="360"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
            />
          </View>

          {/* 首次还款日期 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>首次还款日期</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* 还款方式 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款方式</Text>
            <View style={styles.toggleRow}>
              <Pressable
                style={[
                  styles.toggleBtn,
                  method === 'equal_installment' && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                  { borderColor: method === 'equal_installment' ? Colors.primary : colors.border },
                ]}
                onPress={() => setMethod('equal_installment')}
              >
                <Text style={[styles.toggleText, method === 'equal_installment' && { color: Colors.primary, fontWeight: '600' }]}>
                  等额本息
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.toggleBtn,
                  method === 'equal_principal' && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                  { borderColor: method === 'equal_principal' ? Colors.primary : colors.border },
                ]}
                onPress={() => setMethod('equal_principal')}
              >
                <Text style={[styles.toggleText, method === 'equal_principal' && { color: Colors.primary, fontWeight: '600' }]}>
                  等额本金
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 预估 */}
          {preview && (
            <View style={[styles.previewCard, { backgroundColor: Colors.primary + '08' }]}>
              <Text style={[styles.previewTitle, { color: Colors.primary }]}>还款预估</Text>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
                  {method === 'equal_installment' ? '每月月供' : '首月月供'}
                </Text>
                <Text style={[styles.previewValue, { color: Colors.primary }]}>
                  ¥{preview.monthlyPayment}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>利息总额</Text>
                <Text style={[styles.previewValue, { color: Colors.asset }]}>
                  ¥{preview.totalInterest}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>还款总额</Text>
                <Text style={styles.previewValue}>¥{preview.totalRepayment}</Text>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        <AccountPicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          onSelect={(acc) => {
            setAccount(acc);
            setPickerVisible(false);
          }}
          allowedTypes={['liability'] as AccountType[]}
          selectedId={account?.id}
          bookId={currentBook?.id}
        />

        <AccountPicker
          visible={depositPickerVisible}
          onClose={() => setDepositPickerVisible(false)}
          onSelect={(acc) => {
            setDepositAccount(acc);
            setDepositPickerVisible(false);
          }}
          allowedTypes={['asset'] as AccountType[]}
          selectedId={depositAccount?.id}
          bookId={currentBook?.id}
        />

        {toastMsg ? (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  submitBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  form: {
    flex: 1,
    paddingHorizontal: 16,
  },
  field: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  fieldLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  textInput: {
    fontSize: 15,
    padding: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  toggleText: {
    fontSize: 14,
  },
  previewCard: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  previewLabel: {
    fontSize: 13,
  },
  previewValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  desktopOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopModal: {
    width: 560,
    maxHeight: '90%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
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
});
