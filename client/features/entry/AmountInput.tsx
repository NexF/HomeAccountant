import React, { useState, useCallback } from 'react';
import { StyleSheet, Pressable, Platform, SafeAreaView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  label?: string;
  color?: string;
};

// 安全计算表达式（仅支持 + - × ÷）
function evaluate(expr: string): number | null {
  // 将 × ÷ 替换为 * /
  const normalized = expr.replace(/×/g, '*').replace(/÷/g, '/');
  // 拆分为 tokens: 数字和运算符
  const tokens = normalized.match(/(\d+\.?\d*|[+\-*/])/g);
  if (!tokens || tokens.length === 0) return null;

  // 简单的两遍求值：先乘除，再加减
  // 第一遍：处理 * /
  const stack: (number | string)[] = [];
  let i = 0;
  let num = parseFloat(tokens[0]);
  if (isNaN(num)) return null;
  stack.push(num);
  i = 1;

  while (i < tokens.length) {
    const op = tokens[i];
    const next = parseFloat(tokens[i + 1]);
    if (isNaN(next)) return null;

    if (op === '*') {
      const prev = stack.pop() as number;
      stack.push(prev * next);
    } else if (op === '/') {
      if (next === 0) return null;
      const prev = stack.pop() as number;
      stack.push(prev / next);
    } else {
      stack.push(op);
      stack.push(next);
    }
    i += 2;
  }

  // 第二遍：处理 + -
  let result = stack[0] as number;
  for (let j = 1; j < stack.length; j += 2) {
    const op = stack[j] as string;
    const val = stack[j + 1] as number;
    if (op === '+') result += val;
    else if (op === '-') result -= val;
  }

  return result;
}

// 检查表达式中是否包含运算符
function hasOperator(expr: string): boolean {
  return /[+\-×÷]/.test(expr);
}

// 获取表达式中最后一个数字段（运算符后面的部分）
function getLastSegment(expr: string): string {
  const parts = expr.split(/[+\-×÷]/);
  return parts[parts.length - 1];
}

// 方案 A：4x4 标准计算器布局
// [ 1 ] [ 2 ] [ 3 ] [ + ]
// [ 4 ] [ 5 ] [ 6 ] [ - ]
// [ 7 ] [ 8 ] [ 9 ] [ × ]
// [ . ] [ 0 ] [ ← ] [ ✓ ]
const KEYS = [
  ['1', '2', '3', '+'],
  ['4', '5', '6', '-'],
  ['7', '8', '9', '×'],
  ['.', '0', 'del', 'ok'],
];

export default function AmountInput({ value, onChange, onSubmit, label = '金额', color }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const accentColor = color ?? Colors.primary;

  const handleKey = useCallback((key: string) => {
    if (key === 'del') {
      onChange(value.slice(0, -1) || '');
      return;
    }

    if (key === 'ok') {
      // 有表达式时先计算
      if (hasOperator(value)) {
        const result = evaluate(value);
        if (result !== null && isFinite(result)) {
          // 保留两位小数，去除末尾多余的 0
          const rounded = Math.round(Math.abs(result) * 100) / 100;
          onChange(String(rounded));
        }
        return;
      }
      // 无表达式时提交
      onSubmit?.();
      return;
    }

    // 运算符 + - ×
    if (key === '+' || key === '-' || key === '×') {
      if (!value) return; // 空值不允许以运算符开头
      const lastChar = value[value.length - 1];
      // 如果最后一个字符已是运算符，替换它
      if (/[+\-×÷]/.test(lastChar)) {
        onChange(value.slice(0, -1) + key);
        return;
      }
      // 如果最后一个字符是小数点，先移除
      if (lastChar === '.') {
        onChange(value.slice(0, -1) + key);
        return;
      }
      onChange(value + key);
      return;
    }

    // 小数点
    if (key === '.') {
      const lastSeg = getLastSegment(value);
      if (lastSeg.includes('.')) return; // 当前数字段已有小数点
      if (!lastSeg) {
        onChange(value + '0.');
        return;
      }
      onChange(value + '.');
      return;
    }

    // 数字
    const lastSeg = getLastSegment(value);
    // 限制小数点后两位
    if (lastSeg.includes('.') && lastSeg.split('.')[1].length >= 2) return;
    // 限制整数位数（最多12位）
    if (!lastSeg.includes('.') && lastSeg.replace(/^0+/, '').length >= 12) return;

    onChange(value + key);
  }, [value, onChange, onSubmit]);

  const displayExpr = value || '0';

  // 格式化显示：对表达式中的每个数字段做千分位
  const formatDisplay = useCallback(() => {
    if (!value) return '0';
    // 按运算符拆分，保留运算符
    const parts = value.split(/([+\-×÷])/);
    return parts.map((part) => {
      if (/^[+\-×÷]$/.test(part)) {
        return ` ${part} `;
      }
      // 数字段做千分位
      const segs = part.split('.');
      const intPart = segs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') || '0';
      return segs.length > 1 ? `${intPart}.${segs[1]}` : intPart;
    }).join('');
  }, [value]);

  // 判断确定按钮显示文案
  const okLabel = hasOperator(value) ? '=' : '确定';

  return (
    <View style={styles.container}>
      {/* 金额显示 */}
      <View style={styles.display}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <View style={styles.amountRow}>
          <Text style={[styles.currency, { color: accentColor }]}>¥</Text>
          <Text
            style={[styles.amount, { color: accentColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatDisplay()}
          </Text>
        </View>
      </View>

      {/* 键盘区域 */}
      <View style={[styles.keyboard, { borderTopColor: colors.border }]}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.keyRow}>
            {row.map((key) => {
              const isOp = key === '+' || key === '-' || key === '×';
              const isDel = key === 'del';
              const isOk = key === 'ok';

              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    styles.key,
                    isOk && styles.okKey,
                    isOk && { backgroundColor: accentColor },
                    isOk && pressed && { opacity: 0.8 },
                    (isOp || isDel) && {
                      backgroundColor: pressed
                        ? colorScheme === 'dark' ? '#374151' : '#E5E7EB'
                        : colorScheme === 'dark' ? '#1F2937' : '#F3F4F6',
                    },
                    !isOp && !isDel && !isOk && {
                      backgroundColor: pressed
                        ? colorScheme === 'dark' ? '#374151' : '#E5E7EB'
                        : 'transparent',
                    },
                  ]}
                  onPress={() => handleKey(key)}
                >
                  {isDel ? (
                    <FontAwesome name="long-arrow-left" size={20} color={colors.text} />
                  ) : isOk ? (
                    <Text style={styles.okText}>{okLabel}</Text>
                  ) : isOp ? (
                    <Text style={[styles.opText, { color: colors.text }]}>{key}</Text>
                  ) : (
                    <Text style={[styles.keyText, { color: colors.text }]}>{key}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
  },
  display: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 13,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currency: {
    fontSize: 24,
    fontWeight: '600',
    marginRight: 4,
  },
  amount: {
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  keyboard: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
    paddingBottom: Platform.OS === 'web' ? 2 : 16,
  },
  keyRow: {
    flexDirection: 'row',
  },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Platform.OS === 'web' ? 13 : 15,
  },
  keyText: {
    fontSize: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  opText: {
    fontSize: 20,
    fontWeight: '600',
  },
  okKey: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Platform.OS === 'web' ? 13 : 15,
    borderRadius: 0,
  },
  okText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
