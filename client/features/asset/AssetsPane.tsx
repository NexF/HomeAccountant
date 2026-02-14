import React, { useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAssetStore } from '@/stores/assetStore';
import { type AccountType } from '@/stores/accountStore';
import { type AccountTreeNode } from '@/services/accountService';
import { assetService, type AssetResponse, type DepreciationRecord } from '@/services/assetService';
import AssetCard from '@/features/asset/AssetCard';
import DepreciationChart from '@/features/asset/DepreciationChart';
import AccountPicker from '@/features/entry/AccountPicker';
import { styles, budgetStyles } from '@/features/profile/styles';

const ASSET_STATUS_TABS = [
  { key: null, label: '全部' },
  { key: 'active', label: '使用中' },
  { key: 'disposed', label: '已处置' },
] as const;

const ASSET_METHOD_LABEL: Record<string, string> = {
  straight_line: '直线法',
  none: '不折旧',
};

const ASSET_GRANULARITY_LABEL: Record<string, string> = {
  monthly: '按月',
  daily: '按日',
};

function AssetDetailInline({
  assetId,
  onBack,
  onDeleted,
}: {
  assetId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const currentBook = useBookStore((s) => s.currentBook);

  const [asset, setAsset] = useState<AssetResponse | null>(null);
  const [history, setHistory] = useState<DepreciationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [depreciating, setDepreciating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [showDispose, setShowDispose] = useState(false);
  const [disposalIncome, setDisposalIncome] = useState('');
  const [disposalDate, setDisposalDate] = useState('');
  const [incomeAccount, setIncomeAccount] = useState<AccountTreeNode | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [disposing, setDisposing] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchData = React.useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    try {
      const [assetRes, historyRes] = await Promise.all([
        assetService.getAsset(assetId),
        assetService.getDepreciationHistory(assetId),
      ]);
      setAsset(assetRes.data);
      setHistory(historyRes.data);
    } catch {
      showToast('加载资产信息失败');
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDepreciate = async () => {
    if (!asset) return;
    setDepreciating(true);
    try {
      const { data } = await assetService.depreciate(asset.id);
      setAsset(data.asset);
      const historyRes = await assetService.getDepreciationHistory(asset.id);
      setHistory(historyRes.data);
      showToast(data.message);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '折旧失败');
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
      showToast(data.message);
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '处置失败');
    } finally {
      setDisposing(false);
    }
  };

  const confirmDelete = async () => {
    if (!asset) return;
    setShowDeleteConfirm(false);
    try {
      await assetService.deleteAsset(asset.id);
      onDeleted();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '删除失败');
    }
  };

  if (loading) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={styles.acctCenter}>
        <Text>资产不存在</Text>
      </View>
    );
  }

  const isActive = asset.status === 'active';
  const canDepreciate = isActive && asset.depreciation_method !== 'none' && asset.depreciation_percentage < 100;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Pressable onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{asset.name}</Text>
        <Pressable onPress={() => setShowDeleteConfirm(true)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome name="trash-o" size={18} color={Colors.asset} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
          {([
            ['资产名称', asset.name],
            ['关联科目', asset.account_name],
            ['购入日期', asset.purchase_date],
            ['原值', `¥ ${asset.original_cost.toLocaleString()}`],
            ['残值率', `${asset.residual_rate}%`],
            ['使用寿命', `${asset.useful_life_months} 个月`],
            ['折旧方式', ASSET_METHOD_LABEL[asset.depreciation_method] ?? asset.depreciation_method],
            ['折旧粒度', ASSET_GRANULARITY_LABEL[asset.depreciation_granularity]],
            ['状态', isActive ? '使用中' : '已处置', isActive ? Colors.primary : colors.textSecondary],
          ] as [string, string, string?][]).map(([label, value, valueColor]) => (
            <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
              <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
              <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
            </View>
          ))}
        </View>

        {asset.depreciation_method !== 'none' && (
          <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden' }]}>
            {([
              ['累计折旧', `¥ ${asset.accumulated_depreciation.toLocaleString()}`, Colors.asset],
              ['账面净值', `¥ ${asset.net_book_value.toLocaleString()}`, Colors.primary],
              [asset.depreciation_granularity === 'daily' ? '日折旧额' : '月折旧额', `¥ ${asset.period_depreciation.toFixed(2)}`],
              ['折旧进度', `${asset.depreciation_percentage}%`],
              ['剩余月数', `${asset.remaining_months} 个月`],
            ] as [string, string, string?][]).map(([label, value, valueColor]) => (
              <View key={label} style={[styles.formRow, { borderBottomColor: '#E5E7EB' }]}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>{label}</Text>
                <Text style={[styles.formValue, { color: valueColor ?? colors.text }]}>{value}</Text>
              </View>
            ))}
            <View style={{ padding: 16, paddingTop: 8 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
                <View style={{ height: '100%', borderRadius: 4, backgroundColor: asset.depreciation_percentage >= 100 ? Colors.liability : Colors.primary, width: `${Math.min(asset.depreciation_percentage, 100)}%` }} />
              </View>
            </View>
          </View>
        )}

        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <DepreciationChart records={history} originalCost={asset.original_cost} />
        </View>

        {isActive && (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 16 }}>
            {canDepreciate && (
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary, opacity: depreciating ? 0.6 : 1 }}
                onPress={handleDepreciate}
                disabled={depreciating}
              >
                {depreciating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <FontAwesome name="calculator" size={14} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>计提折旧</Text>
                  </>
                )}
              </Pressable>
            )}
            <Pressable
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.asset }}
              onPress={() => { setDisposalDate(new Date().toISOString().slice(0, 10)); setShowDispose(!showDispose); }}
            >
              <FontAwesome name="trash" size={14} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>处置资产</Text>
            </Pressable>
          </View>
        )}

        {showDispose && (
          <View style={[styles.formCard, { backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 16, padding: 16 }]}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 12 }}>处置资产</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>处置收入</Text>
              <TextInput style={{ flex: 1, fontSize: 14, textAlign: 'right', paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderRadius: 6, color: colors.text, borderColor: colors.border }} value={disposalIncome} onChangeText={setDisposalIncome} placeholder="0.00" placeholderTextColor={colors.textSecondary} keyboardType="decimal-pad" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>处置日期</Text>
              <TextInput style={{ flex: 1, fontSize: 14, textAlign: 'right', paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderRadius: 6, color: colors.text, borderColor: colors.border }} value={disposalDate} onChangeText={setDisposalDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
            </View>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }} onPress={() => setPickerVisible(true)}>
              <Text style={{ fontSize: 14, width: 80, color: colors.textSecondary }}>收款账户</Text>
              <Text style={{ color: incomeAccount ? colors.text : colors.textSecondary, flex: 1, textAlign: 'right' }}>{incomeAccount ? incomeAccount.name : '请选择'}</Text>
              <FontAwesome name="chevron-right" size={12} color={colors.textSecondary} style={{ marginLeft: 8 }} />
            </Pressable>
            <Pressable
              style={{ paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: Colors.asset, opacity: disposing || !incomeAccount ? 0.6 : 1 }}
              onPress={handleDispose}
              disabled={disposing || !incomeAccount}
            >
              {disposing ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>确认处置</Text>}
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <AccountPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(account) => { setIncomeAccount(account); setPickerVisible(false); }}
        allowedTypes={['asset'] as AccountType[]}
        selectedId={incomeAccount?.id}
        bookId={currentBook?.id}
      />

      <Modal visible={showDeleteConfirm} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除资产</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>确定要删除「{asset.name}」吗？此操作不可撤销。</Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setShowDeleteConfirm(false)}><Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text></Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={confirmDelete}><Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text></Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: '#323232', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AssetsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { assets, summary, isLoading, filterStatus, fetchAssets, fetchSummary, setFilterStatus } = useAssetStore();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (currentBook) { fetchAssets(currentBook.id); fetchSummary(currentBook.id); }
  }, [currentBook?.id, filterStatus]);

  const handleAssetPress = (asset: AssetResponse) => { setSelectedAssetId(asset.id); };
  const handleStatusChange = (status: string | null) => { setFilterStatus(status); };
  const handleBackFromDetail = () => { setSelectedAssetId(null); };
  const handleAssetDeleted = () => { setSelectedAssetId(null); if (currentBook) { fetchAssets(currentBook.id); fetchSummary(currentBook.id); } };

  if (selectedAssetId) {
    return <AssetDetailInline assetId={selectedAssetId} onBack={handleBackFromDetail} onDeleted={handleAssetDeleted} />;
  }

  if (isLoading && assets.length === 0) {
    return <View style={styles.acctCenter}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>固定资产</Text>
        <Pressable style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]} onPress={() => router.push('/assets/new' as any)}>
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.saveBtnText}>添加资产</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {summary && (
          <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>资产总原值</Text><Text style={{ fontSize: 16, fontWeight: '700' }}>¥{summary.total_original_cost.toLocaleString()}</Text></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>净值合计</Text><Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>¥{summary.total_net_book_value.toLocaleString()}</Text></View>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>累计折旧</Text><Text style={{ fontSize: 16, fontWeight: '700', color: Colors.asset }}>¥{summary.total_accumulated_depreciation.toLocaleString()}</Text></View>
            </View>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>共 {summary.asset_count} 项资产，{summary.active_count} 项使用中</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
          {ASSET_STATUS_TABS.map((tab) => {
            const active = filterStatus === tab.key;
            return (
              <Pressable key={tab.key ?? 'all'} style={[styles.acctTab, active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary }]} onPress={() => handleStatusChange(tab.key)}>
                <Text style={[styles.acctTabText, { color: active ? Colors.primary : colors.textSecondary }, active && { fontWeight: '600' }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {assets.length === 0 ? (
          <View style={styles.acctEmpty}><FontAwesome name="building-o" size={40} color={colors.textSecondary} /><Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无固定资产</Text></View>
        ) : (
          assets.map((asset) => <AssetCard key={asset.id} asset={asset} onPress={handleAssetPress} />)
        )}
      </ScrollView>
    </View>
  );
}
