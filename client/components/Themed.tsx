/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */

import React, { forwardRef } from 'react';
import {
  Platform,
  Text as DefaultText,
  TextInput as DefaultTextInput,
  View as DefaultView,
} from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText['props'];
export type TextInputProps = DefaultTextInput['props'];
export type ViewProps = ThemeProps & DefaultView['props'];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return <DefaultText style={[{ color }, style]} {...otherProps} />;
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  // 只有显式传入 lightColor/darkColor 时才设置主题背景色，
  // 否则不设背景色（透明），避免子 View 遮盖父容器背景。
  // 页面级背景色由 react-navigation 的 ThemeProvider 提供。
  const hasExplicitColor = !!(lightColor || darkColor);
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return (
    <DefaultView
      style={[hasExplicitColor ? { backgroundColor } : undefined, style]}
      {...otherProps}
    />
  );
}

/**
 * Android TextInput 文字偏上/被裁切，有两层原因：
 *
 * 1. 原生 rn_edit_text_material.xml drawable 的 <inset> 把文字区域往内推
 *    → 已在 android/.../drawable/rn_edit_text_material.xml 中将 inset 清零
 *
 * 2. RN 原生层只在 JS 显式设了 padding 时才调用 setPadding()，
 *    否则沿用 Android EditText 的默认 compound padding（来自 drawable），
 *    导致即使 inset 清零，底层 drawable 自带的 padding 仍然存在。
 *    → 在基础样式里显式设 padding: 0，强制 RN 调用 setPadding(0,0,0,0)
 *
 * style 顺序：[androidBase, 用户style]
 *   - androidBase 先清零所有原生 padding，再设 textAlignVertical
 *   - 用户 style 放后面，可以自由覆盖 padding / height 等
 */
export const TextInput = forwardRef<DefaultTextInput, TextInputProps>(
  (props, ref) => {
    const { style, ...otherProps } = props;

    if (Platform.OS !== 'android') {
      return <DefaultTextInput ref={ref} style={style} {...otherProps} />;
    }

    return (
      <DefaultTextInput
        ref={ref}
        style={[androidBase, style]}
        {...otherProps}
      />
    );
  }
);

const androidBase = {
  padding: 0,
  includeFontPadding: false,
  textAlignVertical: 'center' as const,
};
