import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const TYPE_META: Record<
  string,
  { label: string; icon: React.ComponentProps<typeof FontAwesome>['name']; color: string }
> = {
  expense: { label: '费用', icon: 'shopping-cart', color: '#8B5CF6' },
  income: { label: '收入', icon: 'dollar', color: Colors.asset },
  asset_purchase: { label: '购置资产', icon: 'building', color: '#F59E0B' },
  asset_dispose: { label: '处置资产', icon: 'sign-out', color: '#EF4444' },
  borrow: { label: '借入', icon: 'hand-o-right', color: Colors.liability },
  repay: { label: '还款', icon: 'credit-card', color: '#06B6D4' },
  transfer: { label: '转账', icon: 'exchange', color: Colors.neutral },
  depreciation: { label: '折旧', icon: 'line-chart', color: '#F59E0B' },
  manual: { label: '手动', icon: 'pencil', color: Colors.neutral },
};

function fmtImpact(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return `+¥${s}`;
  if (n < 0) return `-¥${s}`;
  return `¥${s}`;
}

type Props = {
  entry: {
    entry_type: string;
    description: string | null;
    net_worth_impact?: number;
  };
  onPress?: () => void;
};

export default function EntryCard({ entry, onPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const meta = TYPE_META[entry.entry_type] ?? TYPE_META.manual;

  const impact = entry.net_worth_impact ?? 0;
  const impactColor = impact > 0 ? Colors.asset : impact < 0 ? Colors.liability : colors.textSecondary;

  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      style={[styles.card, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}
      {...(onPress ? { onPress } : {})}
    >
      {/* 左侧图标 */}
      <View
        style={[styles.iconWrap, { backgroundColor: meta.color + '14' }]}
      >
        <FontAwesome name={meta.icon} size={16} color={meta.color} />
      </View>

      {/* 中间描述 */}
      <View style={styles.mid}>
        <Text style={styles.desc} numberOfLines={1}>
          {entry.description || meta.label}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {meta.label}
        </Text>
      </View>

      {/* 右侧：净资产影响金额 */}
      <View style={styles.right}>
        <Text style={[styles.impact, { color: impactColor }]}>{fmtImpact(impact)}</Text>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  mid: {
    flex: 1,
  },
  desc: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  meta: {
    fontSize: 12,
  },
  right: {
    alignItems: 'flex-end',
  },
  impact: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
