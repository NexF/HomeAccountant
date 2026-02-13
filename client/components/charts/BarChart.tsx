import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type BarGroup = {
  label: string;
  values: { value: number; color: string; label?: string }[];
};

type Props = {
  data: BarGroup[];
  width?: number;
  height?: number;
  title?: string;
};

function fmtShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toFixed(0);
}

export default function BarChart({ data, width = 340, height = 200, title }: Props) {
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

  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 40;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const allValues = data.flatMap((g) => g.values.map((v) => v.value));
  const maxVal = Math.max(...allValues, 1);

  const groupWidth = chartW / data.length;
  const maxBarsInGroup = Math.max(...data.map((g) => g.values.length));
  const barGap = 4;
  const barWidth = Math.min(
    24,
    (groupWidth - barGap * (maxBarsInGroup + 1)) / maxBarsInGroup,
  );

  const toY = (v: number) => padT + chartH - (v / maxVal) * chartH;

  // Y 轴
  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = (maxVal / yTicks) * i;
    return { val, y: toY(val) };
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
      <Svg width={width} height={height}>
        {yLines.map((yl, i) => (
          <React.Fragment key={i}>
            <Line
              x1={padL}
              y1={yl.y}
              x2={width - padR}
              y2={yl.y}
              stroke={colorScheme === 'dark' ? '#374151' : '#E5E7EB'}
              strokeWidth={0.5}
            />
            <SvgText
              x={padL - 6}
              y={yl.y + 4}
              fill={colors.textSecondary}
              fontSize={10}
              textAnchor="end"
            >
              {fmtShort(yl.val)}
            </SvgText>
          </React.Fragment>
        ))}

        {data.map((group, gi) => {
          const cx = padL + gi * groupWidth + groupWidth / 2;
          const totalBarsW = group.values.length * barWidth + (group.values.length - 1) * barGap;
          const startX = cx - totalBarsW / 2;

          return (
            <React.Fragment key={gi}>
              {group.values.map((bar, bi) => {
                const x = startX + bi * (barWidth + barGap);
                const barH = (bar.value / maxVal) * chartH;
                return (
                  <Rect
                    key={bi}
                    x={x}
                    y={toY(bar.value)}
                    width={barWidth}
                    height={Math.max(barH, 1)}
                    rx={3}
                    fill={bar.color}
                  />
                );
              })}
              <SvgText
                x={cx}
                y={height - 8}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor="middle"
              >
                {group.label}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>

      {/* 图例 */}
      {data[0]?.values.some((v) => v.label) && (
        <View style={styles.legendRow}>
          {data[0].values.map((v, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: v.color }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>{v.label}</Text>
            </View>
          ))}
        </View>
      )}
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
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
  },
});
