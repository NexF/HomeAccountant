import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  entryService,
  type EntryDetailResponse,
  type JournalLineResponse,
} from '@/services/entryService';

const TYPE_LABELS: Record<string, string> = {
  expense: '费用',
  income: '收入',
  asset_purchase: '购买资产',
  borrow: '借入',
  repay: '还款',
  transfer: '转账',
  manual: '手动分录',
};

export default function EntryDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [entry, setEntry] = useState<EntryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDate, setEditDate] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const { data } = await entryService.getEntry(id);
      setEntry(data);
      setEditDesc(data.description ?? '');
      setEditNote(data.note ?? '');
      setEditDate(data.entry_date);
    } catch {
      Alert.alert('错误', '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      const { data } = await entryService.updateEntry(entry.id, {
        description: editDesc || undefined,
        note: editNote || undefined,
        entry_date: editDate || undefined,
      });
      setEntry(data);
      setEditing(false);
    } catch (e: any) {
      Alert.alert('错误', e?.response?.data?.detail ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!entry) return;
    Alert.alert('确认删除', '删除后无法恢复', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await entryService.deleteEntry(entry.id);
            router.back();
          } catch {
            Alert.alert('错误', '删除失败');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.loadingContainer}>
        <Text>分录不存在</Text>
      </View>
    );
  }

  const typeLabel = TYPE_LABELS[entry.entry_type] ?? entry.entry_type;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>分录详情</Text>
        <View style={styles.headerActions}>
          {editing ? (
            <Pressable
              onPress={handleSave}
              style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
              disabled={saving}
            >
              <Text style={styles.actionBtnText}>{saving ? '...' : '保存'}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={() => setEditing(true)} style={styles.headerBtn}>
                <FontAwesome name="pencil" size={18} color={Colors.primary} />
              </Pressable>
              <Pressable onPress={handleDelete} style={styles.headerBtn}>
                <FontAwesome name="trash" size={18} color={Colors.asset} />
              </Pressable>
            </>
          )}
        </View>
      </View>

      <ScrollView style={styles.body}>
        {/* 基本信息 */}
        <View style={[styles.section, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>类型</Text>
            <Text style={styles.value}>{typeLabel}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>日期</Text>
            {editing ? (
              <TextInput
                style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                value={editDate}
                onChangeText={setEditDate}
              />
            ) : (
              <Text style={styles.value}>{entry.entry_date}</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>摘要</Text>
            {editing ? (
              <TextInput
                style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="无"
                placeholderTextColor={colors.textSecondary}
              />
            ) : (
              <Text style={styles.value}>{entry.description || '无'}</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>备注</Text>
            {editing ? (
              <TextInput
                style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="无"
                placeholderTextColor={colors.textSecondary}
              />
            ) : (
              <Text style={styles.value}>{entry.note || '无'}</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>来源</Text>
            <Text style={styles.value}>{entry.source}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>平衡</Text>
            <Text style={[styles.value, { color: entry.is_balanced ? Colors.liability : Colors.asset }]}>
              {entry.is_balanced ? '是' : '否'}
            </Text>
          </View>
        </View>

        {/* 借贷明细 */}
        <View style={styles.linesSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>借贷明细</Text>
          <View style={[styles.linesCard, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
            {/* Header Row */}
            <View style={[styles.lineRow, styles.lineHeaderRow]}>
              <Text style={[styles.lineAccount, styles.lineHeaderText, { color: colors.textSecondary }]}>科目</Text>
              <Text style={[styles.lineAmount, styles.lineHeaderText, { color: colors.textSecondary }]}>借方</Text>
              <Text style={[styles.lineAmount, styles.lineHeaderText, { color: colors.textSecondary }]}>贷方</Text>
            </View>
            {entry.lines.map((line, idx) => (
              <View key={line.id} style={[styles.lineRow, idx < entry.lines.length - 1 && styles.lineRowBorder]}>
                <Text style={styles.lineAccount} numberOfLines={1}>
                  {line.account_name || line.account_code || line.account_id.slice(0, 8)}
                </Text>
                <Text
                  style={[
                    styles.lineAmount,
                    { color: Number(line.debit_amount) > 0 ? Colors.asset : colors.textSecondary },
                  ]}
                >
                  {Number(line.debit_amount) > 0
                    ? `¥${Number(line.debit_amount).toLocaleString()}`
                    : '-'}
                </Text>
                <Text
                  style={[
                    styles.lineAmount,
                    { color: Number(line.credit_amount) > 0 ? Colors.liability : colors.textSecondary },
                  ]}
                >
                  {Number(line.credit_amount) > 0
                    ? `¥${Number(line.credit_amount).toLocaleString()}`
                    : '-'}
                </Text>
              </View>
            ))}
            {/* Total Row */}
            <View style={[styles.lineRow, styles.totalRow]}>
              <Text style={[styles.lineAccount, styles.totalText]}>合计</Text>
              <Text style={[styles.lineAmount, styles.totalText, { color: Colors.asset }]}>
                ¥{entry.lines.reduce((s, l) => s + Number(l.debit_amount), 0).toLocaleString()}
              </Text>
              <Text style={[styles.lineAmount, styles.totalText, { color: Colors.liability }]}>
                ¥{entry.lines.reduce((s, l) => s + Number(l.credit_amount), 0).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* 时间信息 */}
        <View style={[styles.section, { backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>创建时间</Text>
            <Text style={[styles.value, { fontSize: 13, color: colors.textSecondary }]}>
              {new Date(entry.created_at).toLocaleString()}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>更新时间</Text>
            <Text style={[styles.value, { fontSize: 13, color: colors.textSecondary }]}>
              {new Date(entry.updated_at).toLocaleString()}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 52,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  label: {
    fontSize: 14,
    width: 80,
  },
  value: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  editInput: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  linesSection: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  linesCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lineHeaderRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  lineHeaderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  lineRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  lineAccount: {
    flex: 2,
    fontSize: 14,
  },
  lineAmount: {
    flex: 1,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  totalText: {
    fontWeight: '600',
  },
});
