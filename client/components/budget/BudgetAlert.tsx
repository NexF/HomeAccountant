import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import type { BudgetAlert as BudgetAlertType } from '@/services/budgetService';

type Props = {
  alerts: BudgetAlertType[];
};

export default function BudgetAlert({ alerts }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (alerts.length > 0) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [alerts]);

  if (!visible || alerts.length === 0) return null;

  return (
    <View style={styles.container}>
      {alerts.map((a, i) => (
        <View
          key={i}
          style={[
            styles.alert,
            { backgroundColor: a.alert_type === 'exceeded' ? '#EF4444' : '#F59E0B' },
          ]}
        >
          <Text style={styles.text}>{a.message}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    zIndex: 999,
    gap: 6,
  },
  alert: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  text: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
