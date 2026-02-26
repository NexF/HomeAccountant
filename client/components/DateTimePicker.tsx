import React, { useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label?: string;
  labelStyle?: any;
  containerStyle?: any;
  colors?: { text: string; textSecondary: string; border: string };
}

export function DateTimePicker({
  value, onChange, label, labelStyle, containerStyle, colors,
}: DateTimePickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  // 格式化显示：YYYY-MM-DD HH:mm
  const formatDisplay = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 格式化为 ISO 提交格式：YYYY-MM-DDTHH:mm:ss
  const formatISO = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (Platform.OS === 'web') {
    // Web：使用 <input type="datetime-local">
    const webValue = formatISO(value).slice(0, 16); // "YYYY-MM-DDTHH:mm"
    return (
      <View style={containerStyle}>
        {label && <Text style={labelStyle}>{label}</Text>}
        <input
          type="datetime-local"
          value={webValue}
          onChange={(e) => {
            const d = new Date(e.target.value);
            if (!isNaN(d.getTime())) onChange(d);
          }}
          style={{
            fontSize: 16,
            padding: 8,
            border: 'none',
            background: 'transparent',
            color: colors?.text ?? '#1F2937',
            outline: 'none',
          }}
        />
      </View>
    );
  }

  // iOS / Android：使用 @react-native-community/datetimepicker
  // 动态 require 避免 web 端报错
  const RNDateTimePicker = require('@react-native-community/datetimepicker').default;

  return (
    <View style={containerStyle}>
      {label && <Text style={labelStyle}>{label}</Text>}
      <Pressable onPress={() => setShowPicker(true)}>
        <Text style={{ fontSize: 16, color: colors?.text ?? '#1F2937', paddingVertical: 8 }}>
          {formatDisplay(value)}
        </Text>
      </Pressable>
      {showPicker && (
        <RNDateTimePicker
          value={value}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_: any, selectedDate?: Date) => {
            setShowPicker(Platform.OS === 'android');  // Android 选择后自动关闭
            if (selectedDate) onChange(selectedDate);
          }}
          maximumDate={new Date(2100, 0, 1)}
          minuteInterval={1}
        />
      )}
    </View>
  );
}

// 导出工具函数，供提交时使用
export function toISODateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
