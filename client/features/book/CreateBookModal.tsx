import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { TextInput } from '@/components/Themed';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import type { BookResponse } from '@/services/bookService';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (book: BookResponse) => void;
};

function showToast(msg: string) {
  if (Platform.OS === 'web') {
    window.alert(msg);
  } else {
    Alert.alert('提示', msg);
  }
}

export function CreateBookModal({ visible, onClose, onCreated }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { createBook } = useBookStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<'personal' | 'family'>('personal');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const book = await createBook(name.trim(), type);
      onCreated(book);
      setName('');
      setType('personal');
      onClose();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('personal');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[styles.content, { backgroundColor: colors.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>创建新账本</Text>

          {/* 名称输入 */}
          <View style={styles.fieldRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>账本名称</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </View>

          {/* 类型选择 */}
          <View style={styles.fieldRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>账本类型</Text>
            <View style={styles.chipRow}>
              {(['personal', 'family'] as const).map((t) => {
                const active = type === t;
                return (
                  <Pressable
                    key={t}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? Colors.primary : colors.background,
                        borderColor: active ? Colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setType(t)}
                  >
                    <Text
                      style={{
                        color: active ? '#FFFFFF' : colors.text,
                        fontSize: 14,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {t === 'personal' ? '个人' : '家庭'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 按钮 */}
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.border }]}
              onPress={handleClose}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                styles.btn,
                { backgroundColor: name.trim() ? Colors.primary : colors.border },
              ]}
              onPress={handleCreate}
              disabled={!name.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldRow: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
