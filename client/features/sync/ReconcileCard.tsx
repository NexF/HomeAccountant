import React, { useState } from 'react';
import { StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import BalanceCompare from './BalanceCompare';
import type { PendingReconcileItem } from '@/services/syncService';

type Props = {
  item: PendingReconcileItem;
  onConfirm: (entryId: string) => void;
  onSplit: (entryId: string) => void;
  onDismiss?: (entryId: string) => void;
};

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-¥${s}` : `¥${s}`;
}

export default function ReconcileCard({ item, onConfirm, onSplit }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const diff = item.snapshot?.difference ?? 0;
  const diffColor = diff > 0 ? Colors.asset : diff < 0 ? Colors.liability : colors.text;
  const diffLabel = diff > 0 ? '少记收入' : diff < 0 ? '少记费用' : '已平衡';

  // 找出暂挂科目行
  const suspenseLine = item.lines.find(
    (l) => l.account_name === '待分类费用' || l.account_name === '待分类收入',
  );
  const accountLine = item.lines.find(
    (l) => l.account_name !== '待分类费用' && l.account_name !== '待分类收入',
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {/* 头部 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <FontAwesome
            name="exclamation-circle"
            size={16}
            color={diffColor}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.title, { color: colors.text }]}>
            {accountLine?.account_name ?? '对账调节'}
          </Text>
        </View>
        <Text style={[styles.date, { color: colors.textSecondary }]}>{item.entry_date}</Text>
      </View>

      {/* 余额对比 */}
      {item.snapshot && (
        <BalanceCompare
          bookBalance={item.snapshot.book_balance}
          externalBalance={item.snapshot.external_balance}
          difference={item.snapshot.difference}
        />
      )}

      {/* 差异说明 */}
      <View style={styles.diffBadgeRow}>
        <View style={[styles.diffBadge, { backgroundColor: diff > 0 ? '#D1FAE5' : '#FEE2E2' }]}>
          <Text style={{ color: diff > 0 ? '#059669' : '#DC2626', fontSize: 12, fontWeight: '500' }}>
            {diffLabel} {fmt(Math.abs(diff))}
          </Text>
        </View>
        {suspenseLine && (
          <Text style={[styles.suspenseHint, { color: colors.textSecondary }]}>
            暂记到「{suspenseLine.account_name}」
          </Text>
        )}
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
          onPress={() => onConfirm(item.entry_id)}
        >
          <FontAwesome name="check" size={12} color="#FFF" style={{ marginRight: 6 }} />
          <Text style={styles.actionBtnText}>确认分类</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.outlineBtn, { borderColor: Colors.primary }]}
          onPress={() => onSplit(item.entry_id)}
        >
          <FontAwesome name="scissors" size={12} color={Colors.primary} style={{ marginRight: 6 }} />
          <Text style={[styles.actionBtnText, { color: Colors.primary }]}>拆分</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  diffBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    backgroundColor: 'transparent',
  },
  diffBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  suspenseHint: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  outlineBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
});
