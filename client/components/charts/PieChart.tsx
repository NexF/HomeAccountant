import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Slice = {
  label: string;
  value: number;
  percentage: number;
};

type Props = {
  data: Slice[];
  size?: number;
  title?: string;
};

const PALETTE = [
  '#4F46E5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-¥${s}` : `¥${s}`;
}

export default function PieChart({ data, size = 180, title }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card }]}>
        {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
        <Text style={[styles.empty, { color: colors.textSecondary }]}>暂无数据</Text>
      </View>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const total = data.reduce((s, d) => s + Math.abs(d.value), 0);

  let currentAngle = 0;
  const slices = data.map((d, i) => {
    const angle = total > 0 ? (Math.abs(d.value) / total) * 360 : 0;
    const start = currentAngle;
    currentAngle += angle;
    return { ...d, start, end: currentAngle, color: PALETTE[i % PALETTE.length] };
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
      <View style={styles.chartRow}>
        <Svg width={size} height={size}>
          {slices.map((s, i) => {
            if (s.end - s.start < 0.5) return null;
            const path =
              s.end - s.start >= 359.9
                ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
                : arcPath(cx, cy, r, s.start, s.end);
            return <Path key={i} d={path} fill={s.color} />;
          })}
        </Svg>
        <View style={styles.legend}>
          {slices.map((s, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <Text style={[styles.legendLabel, { color: colors.text }]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={[styles.legendPct, { color: colors.textSecondary }]}>
                {s.percentage.toFixed(1)}%
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 30,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'transparent',
  },
  legend: {
    flex: 1,
    gap: 6,
    backgroundColor: 'transparent',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 12,
    flex: 1,
  },
  legendPct: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
