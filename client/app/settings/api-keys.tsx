import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  apiKeyService,
  type ApiKeyResponse,
  type ApiKeyCreateResponse,
} from '@/services/apiKeyService';

const EXPIRY_OPTIONS = [
  { label: '永不过期', value: null },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
  { label: '1 年', days: 365 },
] as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return '从未使用';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ApiKeysScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');

  // 创建 Modal
  const [createVisible, setCreateVisible] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [creating, setCreating] = useState(false);

  // 创建成功 Modal（展示明文 Key）
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyResponse | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchKeys = useCallback(async () => {
    try {
      const { data } = await apiKeyService.list();
      setKeys(data);
    } catch {
      showToast('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!keyName.trim()) {
      showToast('请输入 Key 名称');
      return;
    }
    setCreating(true);
    try {
      const opt = EXPIRY_OPTIONS[expiryIdx];
      let expires_at: string | null = null;
      if ('days' in opt && opt.days) {
        const d = new Date();
        d.setDate(d.getDate() + opt.days);
        expires_at = d.toISOString();
      }
      const { data } = await apiKeyService.create({ name: keyName.trim(), expires_at });
      setCreateVisible(false);
      setCreatedKey(data);
      setCopied(false);
      await fetchKeys();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await Clipboard.setStringAsync(createdKey.key);
      setCopied(true);
      showToast('已复制到剪贴板');
    } catch {
      showToast('复制失败');
    }
  };

  const handleToggleActive = async (key: ApiKeyResponse) => {
    try {
      await apiKeyService.update(key.id, { is_active: !key.is_active });
      await fetchKeys();
      showToast(key.is_active ? '已停用' : '已启用');
    } catch {
      showToast('操作失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiKeyService.delete(deleteTarget.id);
      setDeleteTarget(null);
      await fetchKeys();
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>API Key 管理</Text>
        <Pressable
          style={[styles.createBtn, { backgroundColor: Colors.primary }]}
          onPress={() => {
            setKeyName('');
            setExpiryIdx(0);
            setCreateVisible(true);
          }}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.createBtnText}>创建</Text>
        </Pressable>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : keys.length === 0 ? (
        <View style={styles.center}>
          <FontAwesome name="key" size={48} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 12 }}>暂无 API Key</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>点击右上角创建</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {keys.map((key) => (
            <View
              key={key.id}
              style={[
                styles.card,
                { backgroundColor: colors.card, opacity: key.is_active ? 1 : 0.55 },
              ]}
            >
              <View style={styles.cardHeader}>
                <FontAwesome name="key" size={16} color={key.is_active ? Colors.primary : colors.textSecondary} />
                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                  {key.name}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: key.is_active ? Colors.primary + '15' : colors.textSecondary + '15' },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: key.is_active ? Colors.primary : colors.textSecondary },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      { color: key.is_active ? Colors.primary : colors.textSecondary },
                    ]}
                  >
                    {key.is_active ? '启用' : '停用'}
                  </Text>
                </View>
              </View>

              <View style={styles.cardInfo}>
                <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                  {key.key_prefix}...
                </Text>
                <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                  创建于 {formatDate(key.created_at)}
                </Text>
              </View>

              <View style={styles.cardInfo}>
                <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                  最后使用：{formatDateTime(key.last_used_at)}
                </Text>
              </View>

              <View style={styles.cardInfo}>
                <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                  关联插件：{key.plugin_count} 个
                </Text>
                {key.expires_at && (
                  <Text style={[styles.cardInfoText, { color: colors.textSecondary }]}>
                    过期：{formatDate(key.expires_at)}
                  </Text>
                )}
              </View>

              <View style={styles.cardActions}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: key.is_active ? '#F59E0B15' : Colors.primary + '15' }]}
                  onPress={() => handleToggleActive(key)}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: key.is_active ? '#F59E0B' : Colors.primary }}>
                    {key.is_active ? '停用' : '启用'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: '#EF444415' }]}
                  onPress={() => setDeleteTarget(key)}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#EF4444' }}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 创建 Modal */}
      <Modal visible={createVisible} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setCreateVisible(false)}>
          <Pressable
            style={[styles.modal, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>创建 API Key</Text>

            <View style={[styles.field, { borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>Key 名称</Text>
              <TextInput
                style={{ flex: 1, fontSize: 14, color: colors.text, textAlign: 'right' }}
                value={keyName}
                onChangeText={setKeyName}
                placeholder="如：生产环境主 Key"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={[styles.field, { borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch' }]}>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>过期时间</Text>
              <View style={styles.expiryRow}>
                {EXPIRY_OPTIONS.map((opt, idx) => (
                  <Pressable
                    key={idx}
                    style={[
                      styles.expiryChip,
                      {
                        backgroundColor: expiryIdx === idx ? Colors.primary + '15' : 'transparent',
                        borderColor: expiryIdx === idx ? Colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setExpiryIdx(idx)}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: expiryIdx === idx ? '600' : '400',
                        color: expiryIdx === idx ? Colors.primary : colors.textSecondary,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
                onPress={() => setCreateVisible(false)}
              >
                <Text style={{ fontWeight: '600', color: colors.text }}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: Colors.primary }]}
                onPress={handleCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ fontWeight: '600', color: '#FFF' }}>创建</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 创建成功 Modal — 展示明文 Key */}
      <Modal visible={createdKey !== null} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: colors.card }]}>
            <FontAwesome name="check-circle" size={36} color={Colors.primary} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>API Key 创建成功</Text>

            <View style={[styles.keyDisplay, { backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.text }} selectable numberOfLines={1} ellipsizeMode="middle">
                {createdKey?.key}
              </Text>
            </View>

            <Pressable
              style={[styles.copyBtn, { backgroundColor: copied ? Colors.liability + '15' : Colors.primary + '15' }]}
              onPress={handleCopy}
            >
              <FontAwesome name={copied ? 'check' : 'clipboard'} size={14} color={copied ? Colors.liability : Colors.primary} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: copied ? Colors.liability : Colors.primary, marginLeft: 6 }}>
                {copied ? '已复制' : '复制'}
              </Text>
            </Pressable>

            <View style={[styles.warningBox, { backgroundColor: '#FEF3C7' }]}>
              <FontAwesome name="exclamation-triangle" size={14} color="#D97706" />
              <Text style={{ flex: 1, fontSize: 13, color: '#92400E', marginLeft: 8 }}>
                请立即复制保存此 Key，关闭后无法再次查看！
              </Text>
            </View>

            <Pressable
              style={[styles.modalBtnFull, { backgroundColor: Colors.primary }]}
              onPress={() => setCreatedKey(null)}
            >
              <Text style={{ fontWeight: '600', color: '#FFF' }}>我已保存，关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[styles.modal, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>删除 API Key</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              删除「{deleteTarget?.name}」后，关联的 {deleteTarget?.plugin_count ?? 0} 个插件将一并删除，是否继续？
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
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  createBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
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
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  expiryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  expiryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  modalBtnFull: { paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  keyDisplay: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
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
