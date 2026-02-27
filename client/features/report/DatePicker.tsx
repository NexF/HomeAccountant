import React, { useState } from 'react';
import { StyleSheet, Pressable, Platform } from 'react-native';
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

/** 本地日期 → YYYY-MM-DD（避免 toISOString 的 UTC 时区偏移） */
function toLocalDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLabel(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

/** 字符串 → 本地 Date */
function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00');
}

/** 快捷预设 */
function getPresets(mode: 'date' | 'range') {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const todayStr = toLocalDateStr(now);

  if (mode === 'date') {
    return [
      { label: '今天', value: todayStr },
      { label: '上月末', value: toLocalDateStr(new Date(y, m, 0)) },
      { label: '去年末', value: `${y - 1}-12-31` },
    ];
  }

  const monthStart = toLocalDateStr(new Date(y, m, 1));
  const monthEnd = toLocalDateStr(new Date(y, m + 1, 0));
  const lastMonthStart = toLocalDateStr(new Date(y, m - 1, 1));
  const lastMonthEnd = toLocalDateStr(new Date(y, m, 0));
  const yearStart = `${y}-01-01`;

  return [
    { label: '本月', start: monthStart, end: monthEnd },
    { label: '上月', start: lastMonthStart, end: lastMonthEnd },
    { label: '今年至今', start: yearStart, end: todayStr },
    { label: '去年全年', start: `${y - 1}-01-01`, end: `${y - 1}-12-31` },
  ];
}

/** 正在编辑哪个日期字段 */
type EditingField = 'date' | 'start' | 'end' | null;

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
  const [editingField, setEditingField] = useState<EditingField>(null);

  const presets = getPresets(mode);

  const displayText =
    mode === 'date'
      ? `截至 ${date ? formatLabel(date) : '--'}`
      : `${startDate ? formatLabel(startDate) : '--'} ~ ${endDate ? formatLabel(endDate) : '--'}`;

  const handleNativeChange = (_: any, selectedDate?: Date) => {
    if (!selectedDate) {
      setEditingField(null);
      return;
    }
    const str = toLocalDateStr(selectedDate);
    if (mode === 'date') {
      onDateChange?.(str);
    } else if (editingField === 'start') {
      onRangeChange?.(str, endDate ?? str);
    } else if (editingField === 'end') {
      onRangeChange?.(startDate ?? str, str);
    }
    if (Platform.OS === 'android') setEditingField(null);
  };

  const renderNativePicker = () => {
    if (!editingField) return null;
    const currentValue =
      editingField === 'date'
        ? parseDate(date ?? toLocalDateStr(new Date()))
        : editingField === 'start'
          ? parseDate(startDate ?? toLocalDateStr(new Date()))
          : parseDate(endDate ?? toLocalDateStr(new Date()));

    if (Platform.OS === 'web') {
      const webValue =
        editingField === 'date'
          ? date ?? ''
          : editingField === 'start'
            ? startDate ?? ''
            : endDate ?? '';
      return (
        <View style={styles.webPickerRow}>
          <input
            type="date"
            value={webValue}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (mode === 'date') {
                onDateChange?.(val);
              } else if (editingField === 'start') {
                onRangeChange?.(val, endDate ?? val);
              } else if (editingField === 'end') {
                onRangeChange?.(startDate ?? val, val);
              }
            }}
            style={{
              fontSize: 15,
              padding: 8,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              background: 'transparent',
              color: colors.text,
              outline: 'none',
              flex: 1,
            }}
          />
          <Pressable style={styles.doneBtn} onPress={() => setEditingField(null)}>
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        </View>
      );
    }

    const RNDateTimePicker = require('@react-native-community/datetimepicker').default;
    return (
      <View style={styles.nativePickerWrap}>
        <RNDateTimePicker
          value={currentValue}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(evt: any, d?: Date) => {
            handleNativeChange(evt, d);
          }}
          maximumDate={new Date(2100, 0, 1)}
        />
        {Platform.OS === 'ios' && (
          <Pressable style={styles.doneBtn} onPress={() => setEditingField(null)}>
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        )}
      </View>
    );
  };

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
                    onDateChange?.(p.value);
                    setExpanded(false);
                    setEditingField(null);
                  } else if (mode === 'range' && 'start' in p) {
                    onRangeChange?.(p.start, p.end);
                    setExpanded(false);
                    setEditingField(null);
                  }
                }}
              >
                <Text style={[styles.presetText, { color: Colors.primary }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* 日期选择器触发 */}
          <View style={styles.inputRow}>
            {mode === 'date' ? (
              <Pressable
                style={[
                  styles.dateBtn,
                  { borderColor: editingField === 'date' ? Colors.primary : colors.border },
                ]}
                onPress={() => setEditingField(editingField === 'date' ? null : 'date')}
              >
                <FontAwesome name="calendar-o" size={13} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text style={[styles.dateBtnText, { color: colors.text }]}>
                  {date ? formatLabel(date) : '选择日期'}
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[
                    styles.dateBtn,
                    styles.rangeBtn,
                    { borderColor: editingField === 'start' ? Colors.primary : colors.border },
                  ]}
                  onPress={() => setEditingField(editingField === 'start' ? null : 'start')}
                >
                  <Text style={[styles.dateBtnText, { color: colors.text }]}>
                    {startDate ? formatLabel(startDate) : '开始日期'}
                  </Text>
                </Pressable>
                <Text style={[styles.rangeSep, { color: colors.textSecondary }]}>~</Text>
                <Pressable
                  style={[
                    styles.dateBtn,
                    styles.rangeBtn,
                    { borderColor: editingField === 'end' ? Colors.primary : colors.border },
                  ]}
                  onPress={() => setEditingField(editingField === 'end' ? null : 'end')}
                >
                  <Text style={[styles.dateBtnText, { color: colors.text }]}>
                    {endDate ? formatLabel(endDate) : '结束日期'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* 原生日期选择器 */}
          {renderNativePicker()}
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
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rangeBtn: {
    flex: 1,
  },
  dateBtnText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  rangeSep: {
    fontSize: 13,
  },
  webPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  nativePickerWrap: {
    marginTop: 10,
    alignItems: 'center',
  },
  doneBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  doneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
