import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { AssetResponse } from '@/services/assetService';

type Props = {
  asset: AssetResponse;
  onPress: (asset: AssetResponse) => void;
};

const STATUS_LABEL: Record<string, string> = {
  active: '使用中',
  disposed: '已处置',
};

const GRANULARITY_LABEL: Record<string, string> = {
  monthly: '按月',
  daily: '按日',
};

export default function AssetCard({ asset, onPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDisposed = asset.status === 'disposed';

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => onPress(asset)}
    >
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: Colors.primary + '15' }]}>
          <FontAwesome name="building" size={16} color={Colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>{asset.name}</Text>
          <Text style={[styles.account, { color: colors.textSecondary }]}>
            {asset.account_name}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: isDisposed ? colors.textSecondary + '18' : Colors.primary + '15' },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: isDisposed ? colors.textSecondary : Colors.primary },
            ]}
          >
            {STATUS_LABEL[asset.status]}
          </Text>
        </View>
      </View>

      {/* 折旧进度条 */}
      {!isDisposed && asset.depreciation_method !== 'none' && (
        <View style={styles.progressSection}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
              折旧进度 ({GRANULARITY_LABEL[asset.depreciation_granularity]})
            </Text>
            <Text style={[styles.progressValue, { color: colors.text }]}>
              {asset.depreciation_percentage}%
            </Text>
          </View>
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
      )}

      {/* 数值区 */}
      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>原值</Text>
          <Text style={styles.statValue}>¥ {asset.original_cost.toLocaleString()}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>净值</Text>
          <Text style={[styles.statValue, { color: Colors.primary }]}>
            ¥ {asset.net_book_value.toLocaleString()}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            {asset.depreciation_granularity === 'daily' ? '日折旧' : '月折旧'}
          </Text>
          <Text style={[styles.statValue, { color: Colors.asset }]}>
            ¥ {asset.period_depreciation.toFixed(2)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  account: {
    fontSize: 12,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  stats: {
    flexDirection: 'row',
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
  },
});
