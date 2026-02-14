/**
 * ChartWebView - 原生端 ECharts WebView 容器（预留）
 *
 * 当前阶段图表使用 react-native-svg 纯原生绘制，
 * 如果后续需要更复杂的交互式图表（如 ECharts），
 * 可通过此组件在 WebView 中渲染。
 *
 * 使用方式：
 *   <ChartWebView option={echartsOption} width={340} height={240} />
 */

import React from 'react';
import { StyleSheet, Platform } from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  option?: object;
  width?: number;
  height?: number;
};

export default function ChartWebView({ option, width = 340, height = 240 }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  // 预留组件 — 后续可接入 react-native-webview + ECharts
  return (
    <View style={[styles.container, { width, height, backgroundColor: colors.card }]}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        ECharts WebView 容器（预留）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
  },
});
