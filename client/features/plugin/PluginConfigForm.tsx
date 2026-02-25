import React, { useState } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { AccountPicker } from '@/features/entry';
import type { ConfigSchema, ConfigField } from '@/services/pluginService';
import type { AccountTreeNode } from '@/services/accountService';
import { useAccountStore } from '@/stores/accountStore';

type Props = {
  schema: ConfigSchema;
  config: Record<string, any> | null;
  onSave: (config: Record<string, any>) => void;
  onCancel: () => void;
  loading: boolean;
  bookId?: string;
};

export default function PluginConfigForm({
  schema,
  config,
  onSave,
  onCancel,
  loading,
  bookId,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const field of schema.fields) {
      initial[field.key] = config?.[field.key] ?? field.default ?? (field.type === 'boolean' ? false : null);
    }
    return initial;
  });

  const [pickerField, setPickerField] = useState<string | null>(null);
  const [accountNames, setAccountNames] = useState<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    return names;
  });

  const updateField = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const canSave = schema.fields
    .filter((f) => f.required)
    .every((f) => {
      const val = formData[f.key];
      if (f.type === 'boolean') return true;
      return val !== null && val !== undefined && val !== '';
    });

  const findAccountName = (accountId: string): string => {
    if (accountNames[accountId]) return accountNames[accountId];
    const { tree } = useAccountStore.getState();
    if (!tree) return accountId;
    for (const type of ['asset', 'liability', 'equity', 'income', 'expense'] as const) {
      const found = findInTree(tree[type], accountId);
      if (found) return found;
    }
    return accountId;
  };

  const findInTree = (nodes: AccountTreeNode[], id: string): string | null => {
    for (const node of nodes) {
      if (node.id === id) return node.name;
      if (node.children.length > 0) {
        const found = findInTree(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const renderField = (field: ConfigField) => {
    const value = formData[field.key];

    switch (field.type) {
      case 'string':
      case 'secret':
        return (
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={value ?? ''}
            onChangeText={(v) => updateField(field.key, v)}
            placeholder={field.description || `输入${field.label}`}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry={field.type === 'secret'}
          />
        );

      case 'number':
        return (
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={value != null ? String(value) : ''}
            onChangeText={(v) => {
              const num = v === '' ? null : Number(v);
              updateField(field.key, num);
            }}
            placeholder={field.description || `输入${field.label}`}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
          />
        );

      case 'boolean':
        return (
          <View style={s.switchRow}>
            <Switch
              value={!!value}
              onValueChange={(v) => updateField(field.key, v)}
              trackColor={{ false: colors.border, true: Colors.primary + '60' }}
              thumbColor={value ? Colors.primary : '#f4f3f4'}
            />
          </View>
        );

      case 'select':
        return (
          <View style={s.selectWrap}>
            {field.options?.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  s.selectOption,
                  {
                    borderColor: value === opt.value ? Colors.primary : colors.border,
                    backgroundColor: value === opt.value ? Colors.primary + '12' : 'transparent',
                  },
                ]}
                onPress={() => updateField(field.key, opt.value)}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: value === opt.value ? Colors.primary : colors.text,
                    fontWeight: value === opt.value ? '600' : '400',
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        );

      case 'account_select':
        return (
          <>
            <Pressable
              style={[s.input, { borderColor: colors.border, backgroundColor: colors.background, justifyContent: 'center' }]}
              onPress={() => setPickerField(field.key)}
            >
              <Text style={{ color: value ? colors.text : colors.textSecondary, fontSize: 14 }}>
                {value ? findAccountName(value) : `选择${field.label}`}
              </Text>
            </Pressable>
            <AccountPicker
              visible={pickerField === field.key}
              onClose={() => setPickerField(null)}
              onSelect={(account) => {
                updateField(field.key, account.id);
                setAccountNames((prev) => ({ ...prev, [account.id]: account.name }));
              }}
              selectedId={value}
              bookId={bookId}
            />
          </>
        );

      default:
        return null;
    }
  };

  return (
    <View style={[s.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {schema.fields.map((field) => (
          <View key={field.key} style={s.fieldWrap}>
            <View style={s.labelRow}>
              <Text style={[s.label, { color: colors.text }]}>
                {field.label}
                {field.required && <Text style={{ color: '#EF4444' }}> *</Text>}
              </Text>
            </View>
            {field.description && field.type !== 'string' && field.type !== 'number' && field.type !== 'secret' && (
              <Text style={[s.desc, { color: colors.textSecondary }]}>{field.description}</Text>
            )}
            {renderField(field)}
          </View>
        ))}
      </ScrollView>

      <View style={[s.footer, { borderTopColor: colors.border }]}>
        <Pressable
          style={[s.btn, { backgroundColor: colors.border }]}
          onPress={onCancel}
        >
          <Text style={{ fontWeight: '600', color: colors.text }}>取消</Text>
        </Pressable>
        <Pressable
          style={[s.btn, { backgroundColor: canSave ? Colors.primary : Colors.primary + '40' }]}
          onPress={() => canSave && onSave(formData)}
          disabled={!canSave || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={{ fontWeight: '600', color: '#FFF' }}>保存</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  scroll: {
    maxHeight: 400,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  fieldWrap: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  desc: {
    fontSize: 12,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
});
