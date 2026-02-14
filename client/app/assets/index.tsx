import React, { useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useAssetStore } from '@/stores/assetStore';
import AssetCard from '@/features/asset/AssetCard';
import type { AssetResponse } from '@/services/assetService';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const STATUS_TABS = [
  { key: null, label: '全部' },
  { key: 'active', label: '使用中' },
  { key: 'disposed', label: '已处置' },
] as const;

export default function AssetListScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const currentBook = useBookStore((s) => s.currentBook);
  const { assets, summary, isLoading, filterStatus, fetchAssets, fetchSummary, setFilterStatus } =
    useAssetStore();
  const { isDesktop } = useBreakpoint();

  useEffect(() => {
    if (currentBook) {
      fetchAssets(currentBook.id);
      fetchSummary(currentBook.id);
    }
  }, [currentBook?.id, filterStatus]);

  const handleAssetPress = useCallback(
    (asset: AssetResponse) => {
      router.push(`/assets/${asset.id}` as any);
    },
    [router]
  );

  const handleStatusChange = useCallback(
    (status: string | null) => {
      setFilterStatus(status);
    },
    [setFilterStatus]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>固定资产</Text>
        <Pressable
          style={[styles.addBtn, { backgroundColor: Colors.primary }]}
          onPress={() => router.push('/assets/new' as any)}
        >
          <FontAwesome name="plus" size={14} color="#FFF" />
        </Pressable>
      </View>

      {/* Summary Card */}
      {summary && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                资产总原值
              </Text>
              <Text style={styles.summaryValue}>
                ¥{summary.total_original_cost.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                净值合计
              </Text>
              <Text style={[styles.summaryValue, { color: Colors.primary }]}>
                ¥{summary.total_net_book_value.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                累计折旧
              </Text>
              <Text style={[styles.summaryValue, { color: Colors.asset }]}>
                ¥{summary.total_accumulated_depreciation.toLocaleString()}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryCount, { color: colors.textSecondary }]}>
              共 {summary.asset_count} 项资产，{summary.active_count} 项使用中
            </Text>
          </View>
        </View>
      )}

      {/* Status Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabContent}
      >
        {STATUS_TABS.map((tab) => {
          const active = filterStatus === tab.key;
          return (
            <Pressable
              key={tab.key ?? 'all'}
              style={[
                styles.tab,
                active && { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
              ]}
              onPress={() => handleStatusChange(tab.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? Colors.primary : colors.textSecondary },
                  active && { fontWeight: '600' },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Asset List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : assets.length === 0 ? (
        <View style={styles.center}>
          <FontAwesome name="building-o" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            暂无固定资产
          </Text>
          <Pressable
            style={[styles.emptyBtn, { borderColor: Colors.primary }]}
            onPress={() => router.push('/assets/new' as any)}
          >
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>添加资产</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={isDesktop ? styles.listDesktop : undefined}
        >
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onPress={handleAssetPress} />
          ))}
        </ScrollView>
      )}
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
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  summaryCount: {
    fontSize: 12,
    marginTop: 8,
  },
  tabBar: {
    flexGrow: 0,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  tabContent: {
    gap: 8,
    paddingRight: 12,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  listDesktop: {
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
  emptyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 8,
  },
});
