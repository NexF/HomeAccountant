import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { AboutPane } from '@/features/profile';

export default function AboutScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();

  return (
    <View style={s.container}>
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <FontAwesome name="chevron-left" size={16} color={colors.text} />
        </Pressable>
      </View>
      <AboutPane />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
