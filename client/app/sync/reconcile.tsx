import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
  Alert,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAccountStore, ACCOUNT_TYPE_LABELS, type AccountType } from '@/stores/accountStore';
import {
  syncService,
  type PendingReconcileItem,
} from '@/services/syncService';
import ReconcileCard from '@/features/sync/ReconcileCard';

export default function ReconcileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();
  const { tree, fetchTree } = useAccountStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<PendingReconcileItem[]>([]);

  // 确认弹窗状态
  const [confirmEntryId, setConfirmEntryId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentBook) return;
    try {
      if (!tree) await fetchTree(currentBook.id);
      const { data } = await syncService.getPendingReconciliations(currentBook.id);
      setItems(data);
    } catch {
      // ignore
    }
  }, [currentBook, tree]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleConfirm = (entryId: string) => {
    setConfirmEntryId(entryId);
    setSelectedAccountId(null);
  };

  const doConfirm = async () => {
    if (!confirmEntryId || !selectedAccountId) return;
    setConfirming(true);
    try {
      await syncService.confirmReconciliation(confirmEntryId, selectedAccountId);
      setConfirmEntryId(null);
      await fetchData();
      if (Platform.OS === 'web') {
        window.alert('已确认分类');
      } else {
        Alert.alert('成功', '已确认分类');
      }
    } catch {
      if (Platform.OS === 'web') {
        window.alert('操作失败');
      } else {
        Alert.alert('错误', '操作失败');
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleSplit = (entryId: string) => {
    // TODO: 实现拆分弹窗（复杂UI，本期简化为跳转分录详情编辑）
    if (Platform.OS === 'web') {
      window.alert('拆分功能开发中，请先使用"确认分类"');
    } else {
      Alert.alert('提示', '拆分功能开发中，请先使用"确认分类"');
    }
  };

  // 获取可选的科目列表（费用+收入科目）
  const selectableAccounts = tree
    ? [
        ...(['expense', 'income', 'asset', 'liability'] as AccountType[]).flatMap((type) => {
          const nodes = tree[type] ?? [];
          const flat: { id: string; name: string; code: string; type: AccountType }[] = [];
          const flatten = (ns: typeof nodes) => {
            for (const n of ns) {
              flat.push({ id: n.id, name: n.name, code: n.code, type: type });
              if (n.children.length > 0) flatten(n.children);
            }
          };
          flatten(nodes);
          return flat;
        }),
      ]
    : [];

  return (
    <View style={styles.container}>
      {/* 顶栏 */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="arrow-left" size={16} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>待处理对账</Text>
        <View style={styles.backBtn}>
          {items.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{items.length}</Text>
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <FontAwesome name="check-circle" size={48} color={Colors.liability} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>全部已处理</Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            暂无待确认的对账调节
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {items.map((item) => (
            <ReconcileCard
              key={item.entry_id}
              item={item}
              onConfirm={handleConfirm}
              onSplit={handleSplit}
            />
          ))}
        </ScrollView>
      )}

      {/* 确认分类弹窗 */}
      <Modal
        visible={!!confirmEntryId}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmEntryId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setConfirmEntryId(null)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>选择目标科目</Text>
            <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
              将调节金额分类到以下科目
            </Text>
            <ScrollView style={styles.accountList}>
              {selectableAccounts.map((acc) => (
                <Pressable
                  key={acc.id}
                  style={[
                    styles.accountItem,
                    { borderBottomColor: colors.border },
                    selectedAccountId === acc.id && { backgroundColor: Colors.primary + '15' },
                  ]}
                  onPress={() => setSelectedAccountId(acc.id)}
                >
                  <View style={styles.accountItemLeft}>
                    <Text style={[styles.accountCode, { color: colors.textSecondary }]}>
                      {acc.code}
                    </Text>
                    <Text style={[styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                  </View>
                  <Text style={[styles.accountType, { color: colors.textSecondary }]}>
                    {ACCOUNT_TYPE_LABELS[acc.type]}
                  </Text>
                  {selectedAccountId === acc.id && (
                    <FontAwesome name="check" size={14} color={Colors.primary} style={{ marginLeft: 8 }} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setConfirmEntryId(null)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBtn,
                  { backgroundColor: selectedAccountId ? Colors.primary : colors.border },
                ]}
                onPress={doConfirm}
                disabled={!selectedAccountId || confirming}
              >
                {confirming ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: selectedAccountId ? '#FFF' : colors.textSecondary }]}>
                    确认
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: Colors.asset,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
  },
  emptyHint: {
    fontSize: 13,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalHint: {
    fontSize: 13,
    marginBottom: 16,
  },
  accountList: {
    maxHeight: 300,
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  accountItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  accountCode: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
  },
  accountName: {
    fontSize: 14,
  },
  accountType: {
    fontSize: 11,
    marginLeft: 8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  modalBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
