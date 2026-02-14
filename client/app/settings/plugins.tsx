import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { pluginService, type PluginResponse } from '@/services/pluginService';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle: { label: '空闲', color: '#9CA3AF' },
  running: { label: '同步中', color: '#3B82F6' },
  success: { label: '成功', color: '#10B981' },
  failed: { label: '失败', color: '#EF4444' },
};

const TYPE_LABEL: Record<string, string> = {
  entry: '记账',
  balance: '余额同步',
  both: '记账 + 余额',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return '从未同步';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PluginsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();

  const [loading, setLoading] = useState(true);
  const [plugins, setPlugins] = useState<PluginResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PluginResponse | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchPlugins = useCallback(async () => {
    try {
      const { data } = await pluginService.list();
      setPlugins(data);
    } catch {
      showToast('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await pluginService.delete(deleteTarget.id);
      setDeleteTarget(null);
      await fetchPlugins();
      showToast('已删除');
    } catch {
      showToast('删除失败');
    }
  };

  if (isDesktop) {
    router.back();
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>插件管理</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : plugins.length === 0 ? (
        <View style={styles.center}>
          <FontAwesome name="puzzle-piece" size={48} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 12 }}>暂无插件</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>通过 API Key 注册插件后会显示在此处</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {plugins.map((plugin) => {
            const status = STATUS_CONFIG[plugin.last_sync_status] ?? STATUS_CONFIG.idle;
            return (
              <View
                key={plugin.id}
                style={[styles.card, { backgroundColor: colors.card }]}
              >
                {/* Card Header */}
                <View style={styles.cardHeader}>
                  <FontAwesome name="puzzle-piece" size={16} color={Colors.primary} />
                  <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                    {plugin.name}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: status.color + '15' }]}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={[styles.statusText, { color: status.color }]}>
                      {status.label}
                    </Text>
                  </View>
                </View>

                {/* Description */}
                {plugin.description && (
                  <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }} numberOfLines={2}>
                    {plugin.description}
                  </Text>
                )}

                {/* Info */}
                <View style={styles.cardInfo}>
                  <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                    类型：{TYPE_LABEL[plugin.type] ?? plugin.type}
                  </Text>
                  <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                    同步 {plugin.sync_count} 次
                  </Text>
                </View>

                <View style={styles.cardInfo}>
                  <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                    最后同步：{formatDateTime(plugin.last_sync_at)}
                  </Text>
                </View>

                <View style={styles.cardInfo}>
                  <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                    创建于 {formatDate(plugin.created_at)}
                  </Text>
                </View>

                {/* Error Message */}
                {plugin.last_sync_status === 'failed' && plugin.last_error_message && (
                  <View style={[styles.errorBox, { backgroundColor: '#FEF2F2' }]}>
                    <FontAwesome name="exclamation-circle" size={12} color="#EF4444" />
                    <Text style={{ flex: 1, fontSize: 12, color: '#991B1B', marginLeft: 6 }} numberOfLines={3}>
                      {plugin.last_error_message}
                    </Text>
                  </View>
                )}

                {/* Actions */}
                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: '#EF444415' }]}
                    onPress={() => setDeleteTarget(plugin)}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#EF4444' }}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[styles.modal, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>删除插件</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{deleteTarget?.name}」吗？此操作不可撤销。
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ fontWeight: '600', color: colors.text }}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleDelete}
              >
                <Text style={{ fontWeight: '600', color: '#FFF' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View
          style={[
            styles.toast,
            {
              backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误')
                ? '#EF4444'
                : Colors.primary,
            },
          ]}
        >
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  listContent: { padding: 16, gap: 12 },
  card: { borderRadius: 12, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: 15, fontWeight: '600' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  cardInfo: { flexDirection: 'row', justifyContent: 'space-between' },
  cardInfoText: { fontSize: 12 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 8,
  },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
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
  toast: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 999,
  },
});
