import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, TextInput, View } from '@/components/Themed';
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

  // ── 分类字段 ──
  const multiBookField = useMemo(
    () => schema.fields.find((f) => f.type === 'book_select' && f.multi) ?? null,
    [schema],
  );

  const multiAccountFields = useMemo(
    () =>
      multiBookField
        ? schema.fields.filter(
            (f) => f.type === 'account_select' && f.depends_on === multiBookField.key,
          )
        : [],
    [schema, multiBookField],
  );

  const nonGroupFields = useMemo(
    () =>
      schema.fields.filter(
        (f) =>
          f !== multiBookField && !multiAccountFields.includes(f),
      ),
    [schema, multiBookField, multiAccountFields],
  );

  // ── 初始化 formData ──
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const field of schema.fields) {
      if (field === multiBookField) {
        // 多账本：数组
        initial[field.key] = config?.[field.key] ?? [];
      } else if (multiAccountFields.includes(field)) {
        // 多账本 account_select：映射对象
        initial[field.key] = config?.[field.key] ?? {};
      } else {
        initial[field.key] = config?.[field.key] ?? field.default ?? (field.type === 'boolean' ? false : null);
      }
    }
    return initial;
  });

  const [accountNames, setAccountNames] = useState<Record<string, string>>({});

  // 构建 depends_on 反向索引
  const dependentsMap = useMemo(() => {
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
    if (!pickedAccount) return;
    const { fieldKey, account } = pickedAccount;

    // 多账本模式：组合 key 格式 `${af.key}__${bookId}`
    if (fieldKey.includes('__')) {
      const [realKey, bookId] = fieldKey.split('__');
      setFormData((prev) => ({
        ...prev,
        [realKey]: { ...(prev[realKey] ?? {}), [bookId]: account.id },
      }));
    } else {
      setFormData((prev) => ({ ...prev, [fieldKey]: account.id }));
    }
    setAccountNames((prev) => ({ ...prev, [account.id]: account.name }));
  }, [pickedAccount]);

  // ── 多账本操作函数 ──
  const addBook = (bookId: string) => {
    if (!multiBookField) return;
    setFormData((prev) => {
      const arr: string[] = prev[multiBookField.key] ?? [];
      if (arr.includes(bookId)) return prev;
      const next = { ...prev, [multiBookField.key]: [...arr, bookId] };
      // 为每个 account_select 字段初始化该 book 的映射
      for (const af of multiAccountFields) {
        next[af.key] = { ...(next[af.key] ?? {}) };
      }
      return next;
    });
  };

  const removeBook = (bookId: string) => {
    if (!multiBookField) return;
    setFormData((prev) => {
      const arr: string[] = prev[multiBookField.key] ?? [];
      const next = { ...prev, [multiBookField.key]: arr.filter((id) => id !== bookId) };
      // 清除对应的 account 映射
      for (const af of multiAccountFields) {
        const mapping = { ...(next[af.key] ?? {}) };
        delete mapping[bookId];
        next[af.key] = mapping;
      }
      return next;
    });
  };

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

  // ── canSave ──
  const canSave = useMemo(() => {
    return schema.fields
      .filter((f) => f.required)
      .every((f) => {
        const val = formData[f.key];
        if (f.type === 'boolean') return true;

        // 多账本 book_select：数组非空
        if (f === multiBookField) {
          return Array.isArray(val) && val.length > 0;
        }

        // 多账本 account_select：每个已选 book 都要有值
        if (multiAccountFields.includes(f)) {
          if (!multiBookField) return false;
          const bookIds: string[] = formData[multiBookField.key] ?? [];
          if (bookIds.length === 0) return false;
          if (typeof val !== 'object' || val === null) return false;
          return bookIds.every((bid) => val[bid] != null && val[bid] !== '');
        }

        return val !== null && val !== undefined && val !== '';
      });
  }, [formData, schema, multiBookField, multiAccountFields]);

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

  const handleOpenPicker = (field: ConfigField, bookId?: string) => {
    const depBookId = bookId ?? (field.depends_on ? formData[field.depends_on] : undefined);
    if (!depBookId) return;
    const compositeKey = bookId ? `${field.key}__${bookId}` : field.key;
    const currentVal = bookId
      ? (formData[field.key] as Record<string, string>)?.[bookId]
      : formData[field.key];
    onPickerRequest?.({
      fieldKey: compositeKey,
      bookId: depBookId,
      selectedId: currentVal ?? undefined,
    });
  };

  // ── 渲染单个字段（非分组） ──
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
        // 单账本模式
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
        // 单账本模式
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

  // ── 渲染多账本分组区域 ──
  const renderMultiBookSection = () => {
    if (!multiBookField) return null;

    const selectedBookIds: string[] = formData[multiBookField.key] ?? [];
    const selectedSet = new Set(selectedBookIds);
    const availableBooks = books.filter((b) => !selectedSet.has(b.id));
    const canRemove = !multiBookField.required || selectedBookIds.length > 1;

    return (
      <View style={s.fieldWrap}>
        <View style={s.labelRow}>
          <Text style={[s.label, { color: colors.text }]}>
            {multiBookField.label}
            {multiBookField.required && <Text style={{ color: '#EF4444' }}> *</Text>}
          </Text>
        </View>
        {multiBookField.description && (
          <Text style={[s.desc, { color: colors.textSecondary }]}>{multiBookField.description}</Text>
        )}

        {/* 已选账本分组卡片 */}
        {selectedBookIds.map((bookId) => {
          const book = books.find((b) => b.id === bookId);
          if (!book) return null;
          return (
            <View
              key={bookId}
              style={[s.groupCard, { borderColor: colors.border, backgroundColor: colors.background }]}
            >
              <View style={s.groupHeader}>
                <Text style={[s.groupTitle, { color: colors.text }]}>{book.name}</Text>
                {canRemove && (
                  <Pressable onPress={() => removeBook(bookId)} hitSlop={8}>
                    <FontAwesome name="times" size={14} color={colors.textSecondary} />
                  </Pressable>
                )}
              </View>

              {/* 分组内的 account_select 字段 */}
              {multiAccountFields.map((af) => {
                const mapping = (formData[af.key] ?? {}) as Record<string, string>;
                const accountId = mapping[bookId];
                return (
                  <View key={af.key} style={{ gap: 4 }}>
                    <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                      {af.label}
                      {af.required && <Text style={{ color: '#EF4444' }}> *</Text>}
                    </Text>
                    <Pressable
                      style={[
                        s.input,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.card,
                          justifyContent: 'center',
                        },
                      ]}
                      onPress={() => handleOpenPicker(af, bookId)}
                    >
                      <Text
                        style={{
                          color: accountId ? colors.text : colors.textSecondary,
                          fontSize: 14,
                        }}
                      >
                        {accountId ? findAccountName(accountId) : `选择${af.label}`}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          );
        })}

        {/* 添加账本按钮 + 可选列表 */}
        {availableBooks.length > 0 && (
          <AddBookButton
            availableBooks={availableBooks}
            onAdd={addBook}
            colors={colors}
          />
        )}
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* 多账本分组区域 */}
        {renderMultiBookSection()}

        {/* 非分组字段 */}
        {nonGroupFields.map((field) => (
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

// ── 「+ 添加账本」子组件 ──
function AddBookButton({
  availableBooks,
  onAdd,
  colors,
}: {
  availableBooks: { id: string; name: string }[];
  onAdd: (bookId: string) => void;
  colors: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        style={[s.addBookBtn, { borderColor: Colors.primary + '60' }]}
        onPress={() => setExpanded((v) => !v)}
      >
        <FontAwesome name={expanded ? 'minus' : 'plus'} size={12} color={Colors.primary} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.primary, marginLeft: 6 }}>
          添加账本
        </Text>
      </Pressable>
      {expanded && (
        <View style={s.selectWrap}>
          {availableBooks.map((book) => (
            <Pressable
              key={book.id}
              style={[
                s.selectOption,
                { borderColor: colors.border, backgroundColor: 'transparent' },
              ]}
              onPress={() => {
                onAdd(book.id);
                setExpanded(false);
              }}
            >
              <Text style={{ fontSize: 13, color: colors.text }}>{book.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
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
  groupCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  addBookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
