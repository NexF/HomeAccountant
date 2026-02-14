import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type DataPoint = {
  label: string;
  value: number;
};

type Props = {
  data: DataPoint[];
  width?: number;
  height?: number;
  color?: string;
  title?: string;
};

export default function LineChart({
  data,
  width = 340,
  height = 200,
  color = Colors.primary,
  title,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  if (data.length < 2) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card }]}>
        {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
        <Text style={[styles.empty, { color: colors.textSecondary }]}>数据不足，至少需要 2 个数据点</Text>
      </View>
    );
  }

  const padL = 50;
  const padR = 16;
  const padT = 20;
  const padB = 40;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const yMin = minVal - range * 0.1;
  const yMax = maxVal + range * 0.1;
  const yRange = yMax - yMin;

  const toX = (i: number) => padL + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');

  // Y 轴刻度
  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = yMin + (yRange / yTicks) * i;
    return { val, y: toY(val) };
  });

  // X 轴标签（最多显示 6 个）
  const step = Math.max(1, Math.floor(data.length / 6));
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  function fmtY(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return v.toFixed(0);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
      <Svg width={width} height={height}>
        {/* 网格线 */}
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
              {fmtY(yl.val)}
            </SvgText>
          </React.Fragment>
        ))}

        {/* 折线 */}
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />

        {/* 数据点 */}
        {data.map((d, i) => (
          <Circle
            key={i}
            cx={toX(i)}
            cy={toY(d.value)}
            r={3}
            fill={color}
          />
        ))}

        {/* X 轴标签 */}
        {xLabels.map((d) => {
          const idx = data.indexOf(d);
          return (
            <SvgText
              key={idx}
              x={toX(idx)}
              y={height - 8}
              fill={colors.textSecondary}
              fontSize={10}
              textAnchor="middle"
            >
              {d.label}
            </SvgText>
          );
        })}
      </Svg>
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
});
