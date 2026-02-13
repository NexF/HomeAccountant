import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  KeyboardAvoidingView,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAccountStore } from '@/stores/accountStore';
import { entryService, type EntryType, type EntryCreateParams } from '@/services/entryService';
import { budgetService, type BudgetAlert as BudgetAlertType } from '@/services/budgetService';
import BudgetAlert from '@/components/budget/BudgetAlert';
import type { AccountTreeNode } from '@/services/accountService';
import EntryTypeTab, { ENTRY_TYPES } from '@/components/entry/EntryTypeTab';
import AmountInput from '@/components/entry/AmountInput';
import AccountPicker from '@/components/entry/AccountPicker';
import type { AccountType } from '@/stores/accountStore';

type PickerTarget =
  | 'category'
  | 'payment'
  | 'asset'
  | 'liability'
  | 'from'
  | 'to'
  | 'extra_liability'
  | 'interest_category';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NewEntryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const fetchTree = useAccountStore((s) => s.fetchTree);
  const accountTree = useAccountStore((s) => s.tree);
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 768;

  const [entryType, setEntryType] = useState<EntryType>('expense');
  const [amount, setAmount] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlertType[]>([]);

  const showToast = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  // 选中的科目
  const [categoryAccount, setCategoryAccount] = useState<AccountTreeNode | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<AccountTreeNode | null>(null);
  const [assetAccount, setAssetAccount] = useState<AccountTreeNode | null>(null);
  const [liabilityAccount, setLiabilityAccount] = useState<AccountTreeNode | null>(null);
  const [fromAccount, setFromAccount] = useState<AccountTreeNode | null>(null);
  const [toAccount, setToAccount] = useState<AccountTreeNode | null>(null);
  const [extraLiabilityAccount, setExtraLiabilityAccount] = useState<AccountTreeNode | null>(null);
  const [extraLiabilityAmount, setExtraLiabilityAmount] = useState('');
  const [interestCategoryAccount, setInterestCategoryAccount] = useState<AccountTreeNode | null>(null);

  // 折旧设置（asset_purchase + 固定资产科目时展开）
  const [assetName, setAssetName] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('36');
  const [residualRate, setResidualRate] = useState('5');
  const [depreciationMethod, setDepreciationMethod] = useState<'straight_line' | 'none'>('straight_line');
  const [depreciationGranularity, setDepreciationGranularity] = useState<'monthly' | 'daily'>('monthly');

  // 贷款设置（borrow 类型可选）
  const [enableLoan, setEnableLoan] = useState(false);
  const [loanName, setLoanName] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [totalMonths, setTotalMonths] = useState('');
  const [loanMethod, setLoanMethod] = useState<'equal_installment' | 'equal_principal'>('equal_installment');
  const [loanStartDate, setLoanStartDate] = useState(todayStr());

  // 判断当前选择的资产科目是否为固定资产（code 以 1501 开头）
  const isFixedAssetAccount = assetAccount?.code?.startsWith('1501') ?? false;

  // 贷款还款预估（borrow 用 amount，asset_purchase 用 extraLiabilityAmount）
  const loanPreview = (() => {
    if (!enableLoan) return null;
    const p = entryType === 'asset_purchase' ? (parseFloat(extraLiabilityAmount) || 0) : (parseFloat(amount) || 0);
    const r = parseFloat(annualRate) || 0;
    const m = parseInt(totalMonths) || 0;
    if (p <= 0 || m <= 0) return null;
    const mr = r / 1200;
    let mp: number;
    let ti: number;
    if (loanMethod === 'equal_installment') {
      if (mr === 0) { mp = p / m; ti = 0; }
      else { const f = Math.pow(1 + mr, m); mp = (p * mr * f) / (f - 1); ti = mp * m - p; }
    } else {
      mp = p / m + p * mr;
      let total = 0, rem = p; const pp = p / m;
      for (let i = 0; i < m; i++) { total += rem * mr; rem -= pp; }
      ti = total;
    }
    return { monthlyPayment: mp.toFixed(2), totalInterest: ti.toFixed(2), totalRepayment: (p + ti).toFixed(2) };
  })();

  // AccountPicker 控制
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('category');
  const [pickerAllowedTypes, setPickerAllowedTypes] = useState<AccountType[]>([]);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | undefined>();

  // 当前激活的金额输入（用于还款类型有两个金额）
  const [activeAmountField, setActiveAmountField] = useState<'amount' | 'principal' | 'interest' | 'extra_liability'>('amount');

  useEffect(() => {
    if (currentBook) {
      fetchTree(currentBook.id);
    }
  }, [currentBook]);

  // 从科目树中递归查找指定 code 的科目
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

  // 切换类型时重置科目
  useEffect(() => {
    setCategoryAccount(null);
    setPaymentAccount(null);
    setAssetAccount(null);
    setLiabilityAccount(null);
    setFromAccount(null);
    setToAccount(null);
    setExtraLiabilityAccount(null);
    setExtraLiabilityAmount('');
    setAmount('');
    setPrincipal('');
    setInterest('');
    setAssetName('');
    setUsefulLifeMonths('36');
    setResidualRate('5');
    setDepreciationMethod('straight_line');
    setDepreciationGranularity('monthly');
    setEnableLoan(false);
    setLoanName('');
    setAnnualRate('');
    setTotalMonths('');
    setLoanMethod('equal_installment');
    setLoanStartDate(todayStr());
    setActiveAmountField(entryType === 'repay' ? 'principal' : 'amount');

    // repay 类型默认选中"利息支出 5013"
    if (entryType === 'repay' && accountTree?.expense) {
      const interestExpense = findAccountByCode(accountTree.expense, '5013');
      setInterestCategoryAccount(interestExpense);
    } else {
      setInterestCategoryAccount(null);
    }
  }, [entryType, accountTree]);

  const openPicker = (target: PickerTarget, allowed: AccountType[], selectedId?: string) => {
    setPickerTarget(target);
    setPickerAllowedTypes(allowed);
    setPickerSelectedId(selectedId);
    setPickerVisible(true);
  };

  const handlePickerSelect = (account: AccountTreeNode) => {
    switch (pickerTarget) {
      case 'category':
        setCategoryAccount(account);
        break;
      case 'payment':
        setPaymentAccount(account);
        break;
      case 'asset':
        setAssetAccount(account);
        break;
      case 'liability':
        setLiabilityAccount(account);
        break;
      case 'from':
        setFromAccount(account);
        break;
      case 'to':
        setToAccount(account);
        break;
      case 'extra_liability':
        setExtraLiabilityAccount(account);
        break;
      case 'interest_category':
        setInterestCategoryAccount(account);
        break;
    }
  };

  const currentAmountValue = (() => {
    switch (activeAmountField) {
      case 'principal': return principal;
      case 'interest': return interest;
      case 'extra_liability': return extraLiabilityAmount;
      default: return amount;
    }
  })();

  const handleAmountChange = (val: string) => {
    switch (activeAmountField) {
      case 'principal': setPrincipal(val); break;
      case 'interest': setInterest(val); break;
      case 'extra_liability': setExtraLiabilityAmount(val); break;
      default: setAmount(val); break;
    }
  };

  const typeConfig = ENTRY_TYPES.find((t) => t.key === entryType)!;

  const handleSubmit = async () => {
    if (!currentBook) {
      showToast('提示', '请先选择账本');
      return;
    }
    const params: EntryCreateParams = {
      entry_type: entryType,
      entry_date: entryDate,
      description: description || undefined,
      note: note || undefined,
    };

    try {
      switch (entryType) {
        case 'expense':
          if (!amount || !categoryAccount || !paymentAccount) {
            showToast('提示', '请填写金额、费用科目和支付账户');
            return;
          }
          params.amount = parseFloat(amount);
          params.category_account_id = categoryAccount.id;
          params.payment_account_id = paymentAccount.id;
          break;

        case 'income':
          if (!amount || !categoryAccount || !paymentAccount) {
            showToast('提示', '请填写金额、收入科目和收款账户');
            return;
          }
          params.amount = parseFloat(amount);
          params.category_account_id = categoryAccount.id;
          params.payment_account_id = paymentAccount.id;
          break;

        case 'asset_purchase':
          if (!assetAccount || !paymentAccount) {
            showToast('提示', '请填写资产科目和支付账户');
            return;
          }
          if (isFixedAssetAccount && !assetName.trim()) {
            showToast('提示', '固定资产必须填写资产名称');
            return;
          }
          if (extraLiabilityAccount && extraLiabilityAmount) {
            const selfPay = parseFloat(amount) || 0;
            const loanAmt = parseFloat(extraLiabilityAmount) || 0;
            const totalAmt = selfPay + loanAmt;
            if (totalAmt <= 0) {
              showToast('提示', '资产总金额必须大于0');
              return;
            }
            params.amount = totalAmt;
            params.asset_account_id = assetAccount.id;
            params.payment_account_id = paymentAccount.id;
            params.extra_liability_account_id = extraLiabilityAccount.id;
            params.extra_liability_amount = loanAmt;
            // 贷款设置（购买资产时选了贷款科目且开启贷款详情）
            if (enableLoan) {
              if (!loanName.trim()) { showToast('提示', '请输入贷款名称'); return; }
              const rate = parseFloat(annualRate);
              if (isNaN(rate) || rate < 0) { showToast('提示', '请输入有效的年利率'); return; }
              const months = parseInt(totalMonths);
              if (!months || months <= 0) { showToast('提示', '请输入有效的还款期数'); return; }
              params.loan_name = loanName.trim();
              params.annual_rate = rate;
              params.total_months = months;
              params.repayment_method = loanMethod;
              params.start_date = loanStartDate;
            }
          } else {
            if (!amount) {
              showToast('提示', '请填写金额');
              return;
            }
            params.amount = parseFloat(amount);
            params.asset_account_id = assetAccount.id;
            params.payment_account_id = paymentAccount.id;
          }
          // 折旧设置（固定资产科目时附带）
          if (isFixedAssetAccount && assetName.trim()) {
            params.asset_name = assetName.trim();
            params.useful_life_months = parseInt(usefulLifeMonths) || 36;
            params.residual_rate = parseFloat(residualRate) ?? 5;
            params.depreciation_method = depreciationMethod;
            params.depreciation_granularity = depreciationGranularity;
          }
          break;

        case 'borrow':
          if (!amount || !paymentAccount || !liabilityAccount) {
            showToast('提示', '请填写金额、收款账户和负债科目');
            return;
          }
          if (enableLoan) {
            if (!loanName.trim()) { showToast('提示', '请输入贷款名称'); return; }
            const rate = parseFloat(annualRate);
            if (isNaN(rate) || rate < 0) { showToast('提示', '请输入有效的年利率'); return; }
            const months = parseInt(totalMonths);
            if (!months || months <= 0) { showToast('提示', '请输入有效的还款期数'); return; }
            params.loan_name = loanName.trim();
            params.annual_rate = rate;
            params.total_months = months;
            params.repayment_method = loanMethod;
            params.start_date = loanStartDate;
          }
          params.amount = parseFloat(amount);
          params.payment_account_id = paymentAccount.id;
          params.liability_account_id = liabilityAccount.id;
          break;

        case 'repay':
          if (!principal || !liabilityAccount || !paymentAccount) {
            showToast('提示', '请填写本金、负债科目和支付账户');
            return;
          }
          params.principal = parseFloat(principal);
          params.interest = parseFloat(interest || '0');
          params.liability_account_id = liabilityAccount.id;
          params.payment_account_id = paymentAccount.id;
          if (interestCategoryAccount) {
            params.category_account_id = interestCategoryAccount.id;
          }
          break;

        case 'transfer':
          if (!amount || !fromAccount || !toAccount) {
            showToast('提示', '请填写金额、来源账户和目标账户');
            return;
          }
          params.amount = parseFloat(amount);
          params.from_account_id = fromAccount.id;
          params.to_account_id = toAccount.id;
          break;
      }

      setSubmitting(true);
      await entryService.createEntry(currentBook.id, params);

      // 费用类型记账后检查预算
      if (entryType === 'expense' && categoryAccount) {
        try {
          const { data: checkResult } = await budgetService.checkBudget(
            currentBook.id,
            categoryAccount.id
          );
          if (checkResult.triggered && checkResult.alerts.length > 0) {
            setBudgetAlerts(checkResult.alerts);
            // 延迟返回让用户看到预算提醒
            setTimeout(() => router.back(), 3000);
            return;
          }
        } catch {
          // 预算检查失败不阻塞记账流程
        }
      }

      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '记账失败';
      showToast('错误', typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  };

  const renderAccountField = (
    label: string,
    account: AccountTreeNode | null,
    target: PickerTarget,
    allowedTypes: AccountType[],
  ) => (
    <Pressable
      style={[styles.field, { borderColor: colors.border }]}
      onPress={() => openPicker(target, allowedTypes, account?.id)}
    >
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.fieldValue}>
        {account ? (
          <>
            <FontAwesome
              name={(account.icon as any) || 'circle-o'}
              size={14}
              color={typeConfig.color}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.fieldText}>{account.name}</Text>
          </>
        ) : (
          <Text style={[styles.fieldPlaceholder, { color: colors.textSecondary }]}>请选择</Text>
        )}
        <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
      </View>
    </Pressable>
  );

  const renderAmountField = (
    label: string,
    fieldKey: 'principal' | 'interest' | 'extra_liability',
    value: string,
  ) => (
    <Pressable
      style={[
        styles.field,
        { borderColor: colors.border },
        activeAmountField === fieldKey && { borderColor: typeConfig.color },
      ]}
      onPress={() => setActiveAmountField(fieldKey)}
    >
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.fieldValue}>
        <Text style={[styles.fieldText, { color: value ? colors.text : colors.textSecondary }]}>
          {value ? `¥ ${value}` : '点击输入'}
        </Text>
      </View>
    </Pressable>
  );

  const renderForm = () => {
    switch (entryType) {
      case 'expense':
        return (
          <>
            {renderAccountField('费用科目', categoryAccount, 'category', ['expense'])}
            {renderAccountField('支付账户', paymentAccount, 'payment', ['asset', 'liability'])}
          </>
        );
      case 'income':
        return (
          <>
            {renderAccountField('收入科目', categoryAccount, 'category', ['income'])}
            {renderAccountField('收款账户', paymentAccount, 'payment', ['asset'])}
          </>
        );
      case 'asset_purchase':
        return (
          <>
            {renderAccountField('资产科目', assetAccount, 'asset', ['asset'])}
            {renderAccountField('支付账户', paymentAccount, 'payment', ['asset'])}
            {renderAccountField('贷款(可选)', extraLiabilityAccount, 'extra_liability', ['liability'])}
            {extraLiabilityAccount && (
              <>
                {/* 主金额（点击可切回） */}
                <Pressable
                  style={[
                    styles.field,
                    { borderColor: colors.border },
                    activeAmountField === 'amount' && { borderColor: typeConfig.color },
                  ]}
                  onPress={() => setActiveAmountField('amount')}
                >
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>自付金额</Text>
                  <View style={styles.fieldValue}>
                    <Text style={[styles.fieldText, { color: amount ? colors.text : colors.textSecondary }]}>
                      {amount ? `¥ ${amount}` : '点击输入'}
                    </Text>
                  </View>
                </Pressable>
                {renderAmountField('贷款金额', 'extra_liability', extraLiabilityAmount)}

                {/* 贷款设置（可选） */}
                <Pressable
                  style={[styles.field, { borderColor: colors.border }]}
                  onPress={() => setEnableLoan(!enableLoan)}
                >
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>设置贷款详情（可选）</Text>
                  <View style={styles.fieldValue}>
                    <Text style={[styles.fieldText, { color: enableLoan ? typeConfig.color : colors.textSecondary }]}>
                      {enableLoan ? '已开启，自动创建贷款记录' : '点击开启'}
                    </Text>
                    <FontAwesome name={enableLoan ? 'toggle-on' : 'toggle-off'} size={22} color={enableLoan ? typeConfig.color : colors.textSecondary} />
                  </View>
                </Pressable>

                {enableLoan && (
                  <View style={[styles.depSection, { borderColor: colors.border }]}>
                    <View style={styles.depHeader}>
                      <FontAwesome name="bank" size={14} color={typeConfig.color} />
                      <Text style={[styles.depTitle, { color: colors.text }]}>贷款设置</Text>
                    </View>

                    <View style={[styles.field, { borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>贷款名称</Text>
                      <TextInput
                        style={[styles.textInput, { color: colors.text }]}
                        value={loanName}
                        onChangeText={setLoanName}
                        placeholder="如：房贷、车贷"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={[styles.field, { borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>年利率（%）</Text>
                      <TextInput
                        style={[styles.textInput, { color: colors.text }]}
                        value={annualRate}
                        onChangeText={setAnnualRate}
                        keyboardType="decimal-pad"
                        placeholder="4.9"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={[styles.field, { borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款期数（月）</Text>
                      <TextInput
                        style={[styles.textInput, { color: colors.text }]}
                        value={totalMonths}
                        onChangeText={setTotalMonths}
                        keyboardType="number-pad"
                        placeholder="360"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={[styles.field, { borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>首次还款日期</Text>
                      <TextInput
                        style={[styles.textInput, { color: colors.text }]}
                        value={loanStartDate}
                        onChangeText={setLoanStartDate}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>

                    <View style={[styles.field, { borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款方式</Text>
                      <View style={styles.segmentRow}>
                        <Pressable
                          style={[styles.segmentBtn, loanMethod === 'equal_installment' && { backgroundColor: typeConfig.color }]}
                          onPress={() => setLoanMethod('equal_installment')}
                        >
                          <Text style={[styles.segmentText, loanMethod === 'equal_installment' && styles.segmentTextActive]}>
                            等额本息
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.segmentBtn, loanMethod === 'equal_principal' && { backgroundColor: typeConfig.color }]}
                          onPress={() => setLoanMethod('equal_principal')}
                        >
                          <Text style={[styles.segmentText, loanMethod === 'equal_principal' && styles.segmentTextActive]}>
                            等额本金
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {loanPreview && (
                      <View style={[styles.loanPreviewCard, { backgroundColor: typeConfig.color + '08' }]}>
                        <Text style={[styles.loanPreviewTitle, { color: typeConfig.color }]}>还款预估</Text>
                        <View style={styles.loanPreviewRow}>
                          <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>
                            {loanMethod === 'equal_installment' ? '每月月供' : '首月月供'}
                          </Text>
                          <Text style={[styles.loanPreviewValue, { color: typeConfig.color }]}>
                            ¥{loanPreview.monthlyPayment}
                          </Text>
                        </View>
                        <View style={styles.loanPreviewRow}>
                          <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>利息总额</Text>
                          <Text style={[styles.loanPreviewValue, { color: colors.textSecondary }]}>
                            ¥{loanPreview.totalInterest}
                          </Text>
                        </View>
                        <View style={styles.loanPreviewRow}>
                          <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>还款总额</Text>
                          <Text style={styles.loanPreviewValue}>¥{loanPreview.totalRepayment}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}

            {/* 折旧设置：固定资产科目时自动展开 */}
            {isFixedAssetAccount && (
              <View style={[styles.depSection, { borderColor: colors.border }]}>
                <View style={styles.depHeader}>
                  <FontAwesome name="cog" size={14} color={typeConfig.color} />
                  <Text style={[styles.depTitle, { color: colors.text }]}>折旧设置</Text>
                  <Text style={[styles.depRequired, { color: typeConfig.color }]}>必填</Text>
                </View>

                {/* 资产名称 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>资产名称</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={assetName}
                    onChangeText={setAssetName}
                    placeholder="如 iPhone 16 Pro、Model 3"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 使用寿命 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>使用寿命（月）</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={usefulLifeMonths}
                    onChangeText={setUsefulLifeMonths}
                    keyboardType="numeric"
                    placeholder="36"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 残值率 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>残值率（%）</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={residualRate}
                    onChangeText={setResidualRate}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 折旧方式 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>折旧方式</Text>
                  <View style={styles.segmentRow}>
                    <Pressable
                      style={[styles.segmentBtn, depreciationMethod === 'straight_line' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setDepreciationMethod('straight_line')}
                    >
                      <Text style={[styles.segmentText, depreciationMethod === 'straight_line' && styles.segmentTextActive]}>
                        直线法
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.segmentBtn, depreciationMethod === 'none' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setDepreciationMethod('none')}
                    >
                      <Text style={[styles.segmentText, depreciationMethod === 'none' && styles.segmentTextActive]}>
                        不折旧
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* 折旧粒度 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>折旧粒度</Text>
                  <View style={styles.segmentRow}>
                    <Pressable
                      style={[styles.segmentBtn, depreciationGranularity === 'monthly' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setDepreciationGranularity('monthly')}
                    >
                      <Text style={[styles.segmentText, depreciationGranularity === 'monthly' && styles.segmentTextActive]}>
                        按月
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.segmentBtn, depreciationGranularity === 'daily' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setDepreciationGranularity('daily')}
                    >
                      <Text style={[styles.segmentText, depreciationGranularity === 'daily' && styles.segmentTextActive]}>
                        按日
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          </>
        );
      case 'borrow':
        return (
          <>
            {renderAccountField('负债科目', liabilityAccount, 'liability', ['liability'])}
            {renderAccountField('收款账户', paymentAccount, 'payment', ['asset'])}

            {/* 贷款设置（可选） */}
            <Pressable
              style={[styles.field, { borderColor: colors.border }]}
              onPress={() => setEnableLoan(!enableLoan)}
            >
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>设置贷款详情（可选）</Text>
              <View style={styles.fieldValue}>
                <Text style={[styles.fieldText, { color: enableLoan ? typeConfig.color : colors.textSecondary }]}>
                  {enableLoan ? '已开启，自动创建贷款记录' : '点击开启'}
                </Text>
                <FontAwesome name={enableLoan ? 'toggle-on' : 'toggle-off'} size={22} color={enableLoan ? typeConfig.color : colors.textSecondary} />
              </View>
            </Pressable>

            {enableLoan && (
              <View style={[styles.depSection, { borderColor: colors.border }]}>
                <View style={styles.depHeader}>
                  <FontAwesome name="bank" size={14} color={typeConfig.color} />
                  <Text style={[styles.depTitle, { color: colors.text }]}>贷款设置</Text>
                </View>

                {/* 贷款名称 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>贷款名称</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={loanName}
                    onChangeText={setLoanName}
                    placeholder="如：房贷、车贷"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 年利率 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>年利率（%）</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={annualRate}
                    onChangeText={setAnnualRate}
                    keyboardType="decimal-pad"
                    placeholder="4.9"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 还款期数 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款期数（月）</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={totalMonths}
                    onChangeText={setTotalMonths}
                    keyboardType="number-pad"
                    placeholder="360"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 首次还款日期 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>首次还款日期</Text>
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    value={loanStartDate}
                    onChangeText={setLoanStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                {/* 还款方式 */}
                <View style={[styles.field, { borderColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>还款方式</Text>
                  <View style={styles.segmentRow}>
                    <Pressable
                      style={[styles.segmentBtn, loanMethod === 'equal_installment' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setLoanMethod('equal_installment')}
                    >
                      <Text style={[styles.segmentText, loanMethod === 'equal_installment' && styles.segmentTextActive]}>
                        等额本息
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.segmentBtn, loanMethod === 'equal_principal' && { backgroundColor: typeConfig.color }]}
                      onPress={() => setLoanMethod('equal_principal')}
                    >
                      <Text style={[styles.segmentText, loanMethod === 'equal_principal' && styles.segmentTextActive]}>
                        等额本金
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* 还款预估 */}
                {loanPreview && (
                  <View style={[styles.loanPreviewCard, { backgroundColor: typeConfig.color + '08' }]}>
                    <Text style={[styles.loanPreviewTitle, { color: typeConfig.color }]}>还款预估</Text>
                    <View style={styles.loanPreviewRow}>
                      <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>
                        {loanMethod === 'equal_installment' ? '每月月供' : '首月月供'}
                      </Text>
                      <Text style={[styles.loanPreviewValue, { color: typeConfig.color }]}>
                        ¥{loanPreview.monthlyPayment}
                      </Text>
                    </View>
                    <View style={styles.loanPreviewRow}>
                      <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>利息总额</Text>
                      <Text style={[styles.loanPreviewValue, { color: colors.textSecondary }]}>
                        ¥{loanPreview.totalInterest}
                      </Text>
                    </View>
                    <View style={styles.loanPreviewRow}>
                      <Text style={[styles.loanPreviewLabel, { color: colors.textSecondary }]}>还款总额</Text>
                      <Text style={styles.loanPreviewValue}>¥{loanPreview.totalRepayment}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </>
        );
      case 'repay':
        return (
          <>
            {renderAmountField('本金', 'principal', principal)}
            {renderAmountField('利息', 'interest', interest)}
            {renderAccountField('负债科目', liabilityAccount, 'liability', ['liability'])}
            {renderAccountField('支付账户', paymentAccount, 'payment', ['asset'])}
            {renderAccountField('利息费用科目(可选)', interestCategoryAccount, 'interest_category', ['expense'])}
          </>
        );
      case 'transfer':
        return (
          <>
            {renderAccountField('来源账户', fromAccount, 'from', ['asset'])}
            {renderAccountField('目标账户', toAccount, 'to', ['asset'])}
          </>
        );
      default:
        return null;
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
        <Text style={styles.headerTitle}>记一笔</Text>
        <Pressable
          onPress={handleSubmit}
          style={[styles.submitBtn, { backgroundColor: typeConfig.color, opacity: submitting ? 0.6 : 1 }]}
          disabled={submitting}
        >
          <Text style={styles.submitText}>{submitting ? '...' : '保存'}</Text>
        </Pressable>
      </View>

      {/* Entry Type Tabs */}
      <EntryTypeTab activeType={entryType} onTypeChange={setEntryType} />

      {/* Form Fields */}
      <ScrollView style={styles.formArea} keyboardShouldPersistTaps="handled">
        {/* 描述 */}
        <View style={[styles.field, { borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>摘要</Text>
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            value={description}
            onChangeText={setDescription}
            placeholder="记录一下..."
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* 日期 */}
        <View style={[styles.field, { borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>日期</Text>
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            value={entryDate}
            onChangeText={setEntryDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* 动态表单 */}
        {renderForm()}

        {/* 备注 */}
        <View style={[styles.field, { borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>备注</Text>
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            value={note}
            onChangeText={setNote}
            placeholder="可选"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      </ScrollView>

      {/* Amount Input Keyboard */}
      {entryType === 'repay' || (entryType === 'asset_purchase' && activeAmountField === 'extra_liability') ? (
        <AmountInput
          value={currentAmountValue}
          onChange={handleAmountChange}
          onSubmit={handleSubmit}
          label={
            activeAmountField === 'principal' ? '本金'
            : activeAmountField === 'interest' ? '利息'
            : activeAmountField === 'extra_liability' ? '贷款金额'
            : '金额'
          }
          color={typeConfig.color}
        />
      ) : (
        <AmountInput value={amount} onChange={setAmount} onSubmit={handleSubmit} color={typeConfig.color} />
      )}

      {/* Account Picker Modal */}
      <AccountPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePickerSelect}
        allowedTypes={pickerAllowedTypes}
        selectedId={pickerSelectedId}
        bookId={currentBook?.id}
      />

      {/* Toast 提示 */}
      {toastMsg ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      ) : null}

      {/* 预算提醒 */}
      {budgetAlerts.length > 0 && <BudgetAlert alerts={budgetAlerts} />}
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
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  formArea: {
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
  fieldPlaceholder: {
    flex: 1,
    fontSize: 15,
  },
  textInput: {
    fontSize: 15,
    padding: 0,
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
  depSection: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  depHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  depTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  depRequired: {
    fontSize: 11,
    fontWeight: '600',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  segmentBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#888',
  },
  segmentTextActive: {
    color: '#FFF',
  },
  loanPreviewCard: {
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  loanPreviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  loanPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  loanPreviewLabel: {
    fontSize: 12,
  },
  loanPreviewValue: {
    fontSize: 13,
    fontWeight: '600',
  },
});
