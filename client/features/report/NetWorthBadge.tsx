import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { formatMoney, getAmountColor } from '@/utils/format';
import { usePrivacyStore } from '@/stores/privacyStore';

type Props = {
  netAsset: number;
  change: number;
  totalAsset: number;
  totalLiability: number;
  onPress?: () => void;
};

export default function NetWorthBadge({ netAsset, change, totalAsset, totalLiability, onPress }: Props) {
  const _privacyMode = usePrivacyStore((s) => s.hideAmounts);
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const changeSign = change > 0 ? '+' : change < 0 ? '' : '';
  const changeColor = getAmountColor(change);
  const changeIcon = change > 0 ? 'arrow-up' : change < 0 ? 'arrow-down' : 'minus';

  return (
    <Pressable onPress={onPress} style={[styles.container, { backgroundColor: colors.card }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>净资产</Text>
      <Text style={[styles.amount, { color: colors.text }]}>{formatMoney(netAsset)}</Text>

      <View style={styles.changeBadge}>
        <FontAwesome name={changeIcon} size={10} color={changeColor} />
        <Text style={[styles.changeText, { color: changeColor }]}>
          较上月 {changeSign}{formatMoney(change)}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.item}>
          <Text style={[styles.itemLabel, { color: colors.textSecondary }]}>总资产</Text>
          <Text style={[styles.itemValue, { color: getAmountColor(totalAsset) }]}>{formatMoney(totalAsset)}</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.item}>
          <Text style={[styles.itemLabel, { color: colors.textSecondary }]}>总负债</Text>
          <Text style={[styles.itemValue, { color: getAmountColor(totalLiability, true) }]}>{formatMoney(totalLiability)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
  },
  amount: {
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    marginBottom: 18,
    backgroundColor: 'transparent',
  },
  changeText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: 'transparent',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  itemLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  itemValue: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    width: 1,
    height: 28,
  },
});
