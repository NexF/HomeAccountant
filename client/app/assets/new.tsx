import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  TextInput,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { assetService } from '@/services/assetService';
import AccountPicker from '@/components/entry/AccountPicker';
import type { AccountTreeNode } from '@/services/accountService';
import type { AccountType } from '@/stores/accountStore';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NewAssetScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const params = useLocalSearchParams<{ cost?: string; date?: string }>();
  const currentBook = useBookStore((s) => s.currentBook);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [name, setName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(params.date ?? todayStr());
  const [originalCost, setOriginalCost] = useState(params.cost ?? '');
  const [residualRate, setResidualRate] = useState('5');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('');
  const [depMethod, setDepMethod] = useState<'straight_line' | 'none'>('straight_line');
  const [depGranularity, setDepGranularity] = useState<'monthly' | 'daily'>('monthly');
  const [account, setAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      setToastMsg(`${title}: ${message}`);
      setTimeout(() => setToastMsg(''), 3000);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSubmit = async () => {
    if (!currentBook) {
      showAlert('提示', '请先选择账本');
      return;
    }
    if (!name.trim()) {
      showAlert('提示', '请输入资产名称');
      return;
    }
    if (!account) {
      showAlert('提示', '请选择关联科目');
      return;
    }
    if (!originalCost || parseFloat(originalCost) <= 0) {
      showAlert('提示', '请输入有效的原值');
      return;
    }
    if (!usefulLifeMonths || parseInt(usefulLifeMonths) <= 0) {
      showAlert('提示', '请输入有效的使用寿命');
      return;
    }

    setSubmitting(true);
    try {
      await assetService.createAsset(currentBook.id, {
        name: name.trim(),
        account_id: account.id,
        purchase_date: purchaseDate,
        original_cost: parseFloat(originalCost),
        residual_rate: parseFloat(residualRate) || 5,
        useful_life_months: parseInt(usefulLifeMonths),
        depreciation_method: depMethod,
        depreciation_granularity: depGranularity,
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
          <Text style={styles.headerTitle}>新建固定资产</Text>
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
          {/* 资产名称 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>资产名称</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="如：MacBook Pro"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* 关联科目 */}
          <Pressable
            style={[styles.field, { borderColor: colors.border }]}
            onPress={() => setPickerVisible(true)}
          >
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>关联科目</Text>
            <View style={styles.fieldValue}>
              {account ? (
                <Text style={[styles.fieldText, { color: colors.text }]}>{account.name}</Text>
              ) : (
                <Text style={[styles.fieldText, { color: colors.textSecondary }]}>请选择固定资产科目</Text>
              )}
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} />
            </View>
          </Pressable>

          {/* 购入日期 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>购入日期</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={purchaseDate}
              onChangeText={setPurchaseDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* 原值 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>原值 (¥)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={originalCost}
              onChangeText={setOriginalCost}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>

          {/* 残值率 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>残值率 (%)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={residualRate}
              onChangeText={setResidualRate}
              placeholder="5"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>

          {/* 使用寿命 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>使用寿命 (月)</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text }]}
              value={usefulLifeMonths}
              onChangeText={setUsefulLifeMonths}
              placeholder="36"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
            />
          </View>

          {/* 折旧方式 */}
          <View style={[styles.field, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>折旧方式</Text>
            <View style={styles.toggleRow}>
              <Pressable
                style={[
                  styles.toggleBtn,
                  depMethod === 'straight_line' && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                  { borderColor: depMethod === 'straight_line' ? Colors.primary : colors.border },
                ]}
                onPress={() => setDepMethod('straight_line')}
              >
                <Text style={[styles.toggleText, depMethod === 'straight_line' && { color: Colors.primary, fontWeight: '600' }]}>
                  直线法
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.toggleBtn,
                  depMethod === 'none' && { backgroundColor: colors.textSecondary + '15', borderColor: colors.textSecondary },
                  { borderColor: depMethod === 'none' ? colors.textSecondary : colors.border },
                ]}
                onPress={() => setDepMethod('none')}
              >
                <Text style={[styles.toggleText, depMethod === 'none' && { color: colors.textSecondary, fontWeight: '600' }]}>
                  不折旧
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 折旧粒度 */}
          {depMethod === 'straight_line' && (
            <View style={[styles.field, { borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>折旧粒度</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  style={[
                    styles.toggleBtn,
                    depGranularity === 'monthly' && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                    { borderColor: depGranularity === 'monthly' ? Colors.primary : colors.border },
                  ]}
                  onPress={() => setDepGranularity('monthly')}
                >
                  <Text style={[styles.toggleText, depGranularity === 'monthly' && { color: Colors.primary, fontWeight: '600' }]}>
                    按月
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.toggleBtn,
                    depGranularity === 'daily' && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
                    { borderColor: depGranularity === 'daily' ? Colors.primary : colors.border },
                  ]}
                  onPress={() => setDepGranularity('daily')}
                >
                  <Text style={[styles.toggleText, depGranularity === 'daily' && { color: Colors.primary, fontWeight: '600' }]}>
                    按日
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* 折旧预估 */}
          {depMethod === 'straight_line' && originalCost && usefulLifeMonths && (
            <View style={[styles.previewCard, { backgroundColor: Colors.primary + '08' }]}>
              <Text style={[styles.previewTitle, { color: Colors.primary }]}>折旧预估</Text>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>可折旧总额</Text>
                <Text style={styles.previewValue}>
                  ¥{(
                    parseFloat(originalCost) *
                    (1 - (parseFloat(residualRate) || 5) / 100)
                  ).toFixed(2)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
                  {depGranularity === 'daily' ? '每日折旧额' : '每月折旧额'}
                </Text>
                <Text style={[styles.previewValue, { color: Colors.primary }]}>
                  ¥{(() => {
                    const depreciable = parseFloat(originalCost) * (1 - (parseFloat(residualRate) || 5) / 100);
                    const months = parseInt(usefulLifeMonths) || 1;
                    if (depGranularity === 'daily') {
                      return (depreciable / (months * 30)).toFixed(2);
                    }
                    return (depreciable / months).toFixed(2);
                  })()}
                </Text>
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
          allowedTypes={['asset'] as AccountType[]}
          selectedId={account?.id}
          bookId={currentBook?.id}
        />

        {/* Toast 提示 */}
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
