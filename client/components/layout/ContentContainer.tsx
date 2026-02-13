import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';

type ContentContainerProps = {
  children: React.ReactNode;
  maxWidth?: number;
  scrollable?: boolean;
  style?: any;
};

export default function ContentContainer({
  children,
  maxWidth = 1200,
  scrollable = true,
  style,
}: ContentContainerProps) {
  const content = (
    <View style={[styles.inner, { maxWidth }, style]}>
      {children}
    </View>
  );

  if (scrollable) {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {content}
      </ScrollView>
    );
  }

  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  container: {
    flex: 1,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
