import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { usePrivacyStore } from '@/stores/privacyStore';

type Props = {
  color: string;
  size?: number;
};

export function PrivacyToggle({ color, size = 18 }: Props) {
  const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
  const toggle = usePrivacyStore((s) => s.toggleHideAmounts);

  return (
    <Pressable onPress={toggle} style={styles.btn} hitSlop={8}>
      <FontAwesome
        name={hideAmounts ? 'eye-slash' : 'eye'}
        size={size}
        color={color}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
