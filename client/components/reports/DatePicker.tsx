import React, { useState } from 'react';
import { StyleSheet, Pressable, Platform, TextInput } from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type DatePickerProps = {
  mode: 'date' | 'range';
  date?: string;
  startDate?: string;
  endDate?: string;
  onDateChange?: (date: string) => void;
  onRangeChange?: (start: string, end: string) => void;
};

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

function formatLabel(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

/** 快捷预设 */
function getPresets(mode: 'date' | 'range') {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const todayStr = now.toISOString().slice(0, 10);

  if (mode === 'date') {
    return [
      { label: '今天', value: todayStr },
      { label: '上月末', value: new Date(y, m, 0).toISOString().slice(0, 10) },
      { label: '去年末', value: `${y - 1}-12-31` },
    ];
  }

  const monthStart = new Date(y, m, 1).toISOString().slice(0, 10);
  const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  const lastMonthStart = new Date(y, m - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd = new Date(y, m, 0).toISOString().slice(0, 10);
  const yearStart = `${y}-01-01`;

  return [
    { label: '本月', start: monthStart, end: monthEnd },
    { label: '上月', start: lastMonthStart, end: lastMonthEnd },
    { label: '今年至今', start: yearStart, end: todayStr },
    { label: '去年全年', start: `${y - 1}-01-01`, end: `${y - 1}-12-31` },
  ];
}

export default function DatePicker({
  mode,
  date,
  startDate,
  endDate,
  onDateChange,
  onRangeChange,
}: DatePickerProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [expanded, setExpanded] = useState(false);
  const [editDate, setEditDate] = useState(date ?? '');
  const [editStart, setEditStart] = useState(startDate ?? '');
  const [editEnd, setEditEnd] = useState(endDate ?? '');

  const presets = getPresets(mode);

  const handleApplyDate = () => {
    if (mode === 'date' && isValidDate(editDate)) {
      onDateChange?.(editDate);
      setExpanded(false);
    } else if (mode === 'range' && isValidDate(editStart) && isValidDate(editEnd)) {
      onRangeChange?.(editStart, editEnd);
      setExpanded(false);
    }
  };

  const displayText =
    mode === 'date'
      ? `截至 ${date ? formatLabel(date) : '--'}`
      : `${startDate ? formatLabel(startDate) : '--'} ~ ${endDate ? formatLabel(endDate) : '--'}`;

  return (
    <View style={styles.wrapper}>
      {/* 触发按钮 */}
      <Pressable
        style={[styles.trigger, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setExpanded(!expanded)}
      >
        <FontAwesome name="calendar" size={14} color={colors.textSecondary} />
        <Text style={[styles.triggerText, { color: colors.text }]}>{displayText}</Text>
        <FontAwesome
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={10}
          color={colors.textSecondary}
        />
      </Pressable>

      {/* 展开面板 */}
      {expanded && (
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* 快捷按钮 */}
          <View style={styles.presetRow}>
            {presets.map((p, i) => (
              <Pressable
                key={i}
                style={[styles.presetBtn, { borderColor: Colors.primary }]}
                onPress={() => {
                  if (mode === 'date' && 'value' in p) {
                    setEditDate(p.value);
                    onDateChange?.(p.value);
                    setExpanded(false);
                  } else if (mode === 'range' && 'start' in p) {
                    setEditStart(p.start);
                    setEditEnd(p.end);
                    onRangeChange?.(p.start, p.end);
                    setExpanded(false);
                  }
                }}
              >
                <Text style={[styles.presetText, { color: Colors.primary }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* 自定义输入 */}
          <View style={styles.inputRow}>
            {mode === 'date' ? (
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                value={editDate}
                onChangeText={setEditDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                maxLength={10}
              />
            ) : (
              <>
                <TextInput
                  style={[styles.input, styles.rangeInput, { color: colors.text, borderColor: colors.border }]}
                  value={editStart}
                  onChangeText={setEditStart}
                  placeholder="开始日期"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={10}
                />
                <Text style={[styles.rangeSep, { color: colors.textSecondary }]}>~</Text>
                <TextInput
                  style={[styles.input, styles.rangeInput, { color: colors.text, borderColor: colors.border }]}
                  value={editEnd}
                  onChangeText={setEditEnd}
                  placeholder="结束日期"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={10}
                />
              </>
            )}
            <Pressable style={styles.applyBtn} onPress={handleApplyDate}>
              <Text style={styles.applyText}>确定</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 10,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  triggerText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  panel: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  presetBtn: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetText: {
    fontSize: 13,
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  rangeInput: {
    flex: 1,
  },
  rangeSep: {
    fontSize: 13,
  },
  applyBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  applyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
