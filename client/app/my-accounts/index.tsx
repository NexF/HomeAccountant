import React from 'react';
import { Stack } from 'expo-router';
import MyAccountsPane from '@/features/profile/MyAccountsPane';

export default function MyAccountsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '我的账户' }} />
      <MyAccountsPane />
    </>
  );
}
