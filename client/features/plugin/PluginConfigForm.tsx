import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { ConfigSchema, ConfigField } from '@/services/pluginService';
import type { AccountTreeNode } from '@/services/accountService';
import { useAccountStore } from '@/stores/accountStore';
import { useBookStore } from '@/stores/bookStore';

export type PickerRequest = {
  fieldKey: string;
  bookId: string;
  selectedId?: string;
} | null;

type Props = {
  schema: ConfigSchema;
  config: Record<string, any> | null;
  onSave: (config: Record<string, any>) => void;
  onCancel: () => void;
  loading: boolean;
  onPickerRequest?: (request: PickerRequest) => void;
  pickedAccount?: { fieldKey: string; account: AccountTreeNode } | null;
};

export default function PluginConfigForm({
  schema,
  config,
  onSave,
  onCancel,
  loading,
  onPickerRequest,
  pickedAccount,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { books } = useBookStore();

  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const field of schema.fields) {
      initial[field.key] = config?.[field.key] ?? field.default ?? (field.type === 'boolean' ? false : null);
    }
    return initial;
  });

  const [accountNames, setAccountNames] = useState<Record<string, string>>({});

  // 构建 depends_on 反向索引：book_select key → 依赖它的 account_select keys
  const dependentsMap = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of schema.fields) {
      if (field.depends_on) {
        if (!map[field.depends_on]) map[field.depends_on] = [];
        map[field.depends_on].push(field.key);
      }
    }
    return map;
  }, [schema]);

  // 接收父组件通过 AccountPicker 选中的科目
  useEffect(() => {
    if (pickedAccount) {
      const { fieldKey, account } = pickedAccount;
      setFormData((prev) => ({ ...prev, [fieldKey]: account.id }));
      setAccountNames((prev) => ({ ...prev, [account.id]: account.name }));
    }
  }, [pickedAccount]);

  const updateField = (key: string, value: any) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      const deps = dependentsMap[key];
      if (deps) {
        for (const depKey of deps) {
          next[depKey] = null;
        }
      }
      return next;
    });
    const deps = dependentsMap[key];
    if (deps) {
      setAccountNames((prev) => {
        const next = { ...prev };
        for (const depKey of deps) {
          const oldVal = formData[depKey];
          if (oldVal) delete next[oldVal];
        }
        return next;
      });
    }
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

  const handleOpenPicker = (field: ConfigField) => {
    const depBookId = field.depends_on ? formData[field.depends_on] : undefined;
    if (!depBookId) return;
    onPickerRequest?.({
      fieldKey: field.key,
      bookId: depBookId,
      selectedId: formData[field.key] ?? undefined,
    });
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

      case 'book_select':
        return (
          <View style={s.selectWrap}>
            {books.map((book) => (
              <Pressable
                key={book.id}
                style={[
                  s.selectOption,
                  {
                    borderColor: value === book.id ? Colors.primary : colors.border,
                    backgroundColor: value === book.id ? Colors.primary + '12' : 'transparent',
                  },
                ]}
                onPress={() => updateField(field.key, book.id)}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: value === book.id ? Colors.primary : colors.text,
                    fontWeight: value === book.id ? '600' : '400',
                  }}
                >
                  {book.name}
                </Text>
              </Pressable>
            ))}
          </View>
        );

      case 'account_select': {
        const depBookId = field.depends_on ? formData[field.depends_on] : undefined;
        const disabled = !depBookId;
        return (
          <Pressable
            style={[
              s.input,
              {
                borderColor: colors.border,
                backgroundColor: disabled ? colors.border + '30' : colors.background,
                justifyContent: 'center',
                opacity: disabled ? 0.6 : 1,
              },
            ]}
            onPress={() => handleOpenPicker(field)}
            disabled={disabled}
          >
            <Text style={{ color: disabled ? colors.textSecondary : (value ? colors.text : colors.textSecondary), fontSize: 14 }}>
              {disabled ? '请先选择账本' : (value ? findAccountName(value) : `选择${field.label}`)}
            </Text>
          </Pressable>
        );
      }

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
