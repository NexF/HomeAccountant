import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  TextInput,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  assetService,
  type AssetResponse,
  type DepreciationRecord,
} from '@/services/assetService';
import DepreciationChart from '@/components/assets/DepreciationChart';
import AccountPicker from '@/components/entry/AccountPicker';
import type { AccountTreeNode } from '@/services/accountService';
import type { AccountType } from '@/stores/accountStore';

const METHOD_LABEL: Record<string, string> = {
  straight_line: '直线法',
  none: '不折旧',
};

const GRANULARITY_LABEL: Record<string, string> = {
  monthly: '按月',
  daily: '按日',
};

export default function AssetDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentBook = useBookStore((s) => s.currentBook);

  const [asset, setAsset] = useState<AssetResponse | null>(null);
  const [history, setHistory] = useState<DepreciationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [depreciating, setDepreciating] = useState(false);

  // 处置相关
  const [showDispose, setShowDispose] = useState(false);
  const [disposalIncome, setDisposalIncome] = useState('');
  const [disposalDate, setDisposalDate] = useState('');
  const [incomeAccount, setIncomeAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [disposing, setDisposing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [assetRes, historyRes] = await Promise.all([
        assetService.getAsset(id),
        assetService.getDepreciationHistory(id),
      ]);
      setAsset(assetRes.data);
      setHistory(historyRes.data);
    } catch {
      Alert.alert('错误', '加载资产信息失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDepreciate = async () => {
    if (!asset) return;
    setDepreciating(true);
    try {
      const { data } = await assetService.depreciate(asset.id);
      setAsset(data.asset);
      const historyRes = await assetService.getDepreciationHistory(asset.id);
      setHistory(historyRes.data);
      const msg = data.message;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('成功', msg);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '折旧失败';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('错误', msg);
    } finally {
      setDepreciating(false);
    }
  };

  const handleDispose = async () => {
    if (!asset || !incomeAccount) return;
    setDisposing(true);
    try {
      const { data } = await assetService.dispose(asset.id, {
        disposal_income: parseFloat(disposalIncome || '0'),
        disposal_date: disposalDate || new Date().toISOString().slice(0, 10),
        income_account_id: incomeAccount.id,
      });
      setAsset(data.asset);
      setShowDispose(false);
      const msg = data.message;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('成功', msg);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? '处置失败';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('错误', msg);
    } finally {
      setDisposing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={styles.center}>
        <Text>资产不存在</Text>
      </View>
    );
  }

  const isActive = asset.status === 'active';
  const canDepreciate = isActive && asset.depreciation_method !== 'none' && asset.depreciation_percentage < 100;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{asset.name}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView style={styles.scroll}>
        {/* 基本信息 */}
        <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
          <InfoRow label="资产名称" value={asset.name} colors={colors} />
          <InfoRow label="关联科目" value={asset.account_name} colors={colors} />
          <InfoRow label="购入日期" value={asset.purchase_date} colors={colors} />
          <InfoRow
            label="原值"
            value={`¥ ${asset.original_cost.toLocaleString()}`}
            colors={colors}
          />
          <InfoRow label="残值率" value={`${asset.residual_rate}%`} colors={colors} />
          <InfoRow label="使用寿命" value={`${asset.useful_life_months} 个月`} colors={colors} />
          <InfoRow
            label="折旧方式"
            value={METHOD_LABEL[asset.depreciation_method] ?? asset.depreciation_method}
            colors={colors}
          />
          <InfoRow
            label="折旧粒度"
            value={GRANULARITY_LABEL[asset.depreciation_granularity]}
            colors={colors}
          />
          <InfoRow
            label="状态"
            value={asset.status === 'active' ? '使用中' : '已处置'}
            colors={colors}
            valueColor={asset.status === 'active' ? Colors.primary : colors.textSecondary}
          />
        </View>

        {/* 折旧信息 */}
        {asset.depreciation_method !== 'none' && (
          <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
            <InfoRow
              label="累计折旧"
              value={`¥ ${asset.accumulated_depreciation.toLocaleString()}`}
              colors={colors}
              valueColor={Colors.asset}
            />
            <InfoRow
              label="账面净值"
              value={`¥ ${asset.net_book_value.toLocaleString()}`}
              colors={colors}
              valueColor={Colors.primary}
            />
            <InfoRow
              label={asset.depreciation_granularity === 'daily' ? '日折旧额' : '月折旧额'}
              value={`¥ ${asset.period_depreciation.toFixed(2)}`}
              colors={colors}
            />
            <InfoRow
              label="折旧进度"
              value={`${asset.depreciation_percentage}%`}
              colors={colors}
            />
            <InfoRow
              label="剩余月数"
              value={`${asset.remaining_months} 个月`}
              colors={colors}
            />

            {/* 进度条 */}
            <View style={styles.progressSection}>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      backgroundColor: asset.depreciation_percentage >= 100 ? Colors.liability : Colors.primary,
                      width: `${Math.min(asset.depreciation_percentage, 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        )}

        {/* 折旧历史 */}
        <DepreciationChart records={history} originalCost={asset.original_cost} />

        {/* 操作按钮 */}
        {isActive && (
          <View style={styles.actions}>
            {canDepreciate && (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
                onPress={handleDepreciate}
                disabled={depreciating}
              >
                {depreciating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <FontAwesome name="calculator" size={14} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.actionBtnText}>计提折旧</Text>
                  </>
                )}
              </Pressable>
            )}

            <Pressable
              style={[styles.actionBtn, { backgroundColor: Colors.asset }]}
              onPress={() => {
                setDisposalDate(new Date().toISOString().slice(0, 10));
                setShowDispose(!showDispose);
              }}
            >
              <FontAwesome name="trash" size={14} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.actionBtnText}>处置资产</Text>
            </Pressable>
          </View>
        )}

        {/* 处置表单 */}
        {showDispose && (
          <View style={[styles.disposeForm, { backgroundColor: colors.card }]}>
            <Text style={[styles.disposeTitle, { color: colors.text }]}>处置资产</Text>

            <View style={styles.formRow}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>处置收入</Text>
              <TextInput
                style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
                value={disposalIncome}
                onChangeText={setDisposalIncome}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.formRow}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>处置日期</Text>
              <TextInput
                style={[styles.formInput, { color: colors.text, borderColor: colors.border }]}
                value={disposalDate}
                onChangeText={setDisposalDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <Pressable
              style={[styles.formRow, { borderBottomWidth: 0 }]}
              onPress={() => setPickerVisible(true)}
            >
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>收款账户</Text>
              <Text style={{ color: incomeAccount ? colors.text : colors.textSecondary, flex: 1, textAlign: 'right' }}>
                {incomeAccount ? incomeAccount.name : '请选择'}
              </Text>
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} style={{ marginLeft: 8 }} />
            </Pressable>

            <Pressable
              style={[styles.disposeBtn, { backgroundColor: Colors.asset, opacity: disposing ? 0.6 : 1 }]}
              onPress={handleDispose}
              disabled={disposing || !incomeAccount}
            >
              {disposing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.actionBtnText}>确认处置</Text>
              )}
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <AccountPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(account) => {
          setIncomeAccount(account);
          setPickerVisible(false);
        }}
        allowedTypes={['asset'] as AccountType[]}
        selectedId={incomeAccount?.id}
        bookId={currentBook?.id}
      />
    </View>
  );
}

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
  progressSection: {
    padding: 16,
    paddingTop: 8,
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
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  disposeForm: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
  },
  disposeTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  formLabel: {
    fontSize: 14,
    width: 80,
  },
  formInput: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
  disposeBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
