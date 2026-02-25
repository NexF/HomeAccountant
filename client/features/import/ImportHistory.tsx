import React, { useState } from 'react';
import { StyleSheet, Pressable, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { ImportHistoryItem } from '@/services/importService';

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  parsed: { text: '已解析', color: '#9CA3AF' },
  partial: { text: '部分导入', color: '#F59E0B' },
  imported: { text: '已导入', color: '#10B981' },
};

type Props = {
  items: ImportHistoryItem[];
  onDelete: (taskId: string) => Promise<void>;
};

export default function ImportHistory({ items, onDelete }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [deleteTarget, setDeleteTarget] = useState<ImportHistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  if (items.length === 0) {
    return (
      <View style={s.empty}>
        <FontAwesome name="history" size={32} color={colors.textSecondary} />
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8 }}>暂无导入记录</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={[s.title, { color: colors.text }]}>导入历史</Text>
      {items.map((item) => {
        const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.parsed;
        return (
          <View key={item.id} style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.cardHeader}>
              <FontAwesome name="file-excel-o" size={14} color={Colors.primary} />
              <Text style={[s.filename, { color: colors.text }]} numberOfLines={1}>
                {item.original_filename}
              </Text>
              <View style={[s.statusBadge, { backgroundColor: status.color + '15' }]}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: status.color }}>{status.text}</Text>
              </View>
            </View>

            <View style={s.infoRow}>
              <Text style={[s.infoText, { color: colors.textSecondary }]}>
                共 {item.total_rows} 行 · 已导入 {item.imported_rows} · 跳过 {item.skipped_rows}
              </Text>
              <Text style={[s.infoText, { color: colors.textSecondary }]}>
                {new Date(item.created_at).toLocaleDateString('zh-CN')}
              </Text>
            </View>

            {(item.status === 'partial' || item.status === 'imported') && (
              <Pressable
                style={s.undoBtn}
                onPress={() => setDeleteTarget(item)}
              >
                <FontAwesome name="undo" size={11} color="#EF4444" />
                <Text style={{ fontSize: 12, color: '#EF4444', marginLeft: 4 }}>撤销</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {/* 撤销确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={s.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[s.modal, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>撤销导入</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要撤销「{deleteTarget?.original_filename}」的导入吗？已导入的分录将被删除。
            </Text>
            <View style={s.modalBtns}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ fontWeight: '600', color: colors.text }}>取消</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleDelete}
                disabled={deleting}
              >
                <Text style={{ fontWeight: '600', color: '#FFF' }}>
                  {deleting ? '撤销中...' : '撤销'}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 10 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 4 },
  title: { fontSize: 16, fontWeight: '600', paddingHorizontal: 4, marginBottom: 4 },
  card: { borderRadius: 12, padding: 14, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filename: { flex: 1, fontSize: 14, fontWeight: '500' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoText: { fontSize: 12 },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: { width: '85%', maxWidth: 420, borderRadius: 14, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
});
