import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Modal, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as Clipboard from 'expo-clipboard';
import {
  apiKeyService,
  type ApiKeyResponse,
  type ApiKeyCreateResponse,
} from '@/services/apiKeyService';
import { styles, budgetStyles } from '@/features/profile/styles';

const EXPIRY_OPTIONS = [
  { label: '永不过期', value: null },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
  { label: '1 年', days: 365 },
] as const;

function formatKeyDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatKeyDateTime(iso: string | null) {
  if (!iso) return '从未使用';
  return new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ApiKeysPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');

  const [createVisible, setCreateVisible] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [creating, setCreating] = useState(false);

  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!keyName.trim()) { showToast('请输入 Key 名称'); return; }
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

  if (loading) {
    return (
      <View style={styles.acctCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.detailContent, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>API Key 管理</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, flexDirection: 'row', gap: 6 }]}
          onPress={() => { setKeyName(''); setExpiryIdx(0); setCreateVisible(true); }}
        >
          <FontAwesome name="plus" size={12} color="#FFF" />
          <Text style={styles.saveBtnText}>创建 Key</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {keys.length === 0 ? (
          <View style={styles.acctEmpty}>
            <FontAwesome name="key" size={40} color={colors.textSecondary} />
            <Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无 API Key</Text>
          </View>
        ) : (
          keys.map((key) => (
            <View
              key={key.id}
              style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12, opacity: key.is_active ? 1 : 0.55 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FontAwesome name="key" size={16} color={key.is_active ? Colors.primary : colors.textSecondary} />
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }} numberOfLines={1}>{key.name}</Text>
                <View style={[styles.directionBadge, { backgroundColor: key.is_active ? Colors.primary + '15' : colors.textSecondary + '15' }]}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: key.is_active ? Colors.primary : colors.textSecondary, marginRight: 4 }} />
                  <Text style={[styles.directionText, { color: key.is_active ? Colors.primary : colors.textSecondary }]}>
                    {key.is_active ? '启用' : '停用'}
                  </Text>
                </View>
              </View>

              <View style={{ gap: 4, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>{key.key_prefix}...</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>创建于 {formatKeyDate(key.created_at)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>最后使用：{formatKeyDateTime(key.last_used_at)}</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>关联插件：{key.plugin_count} 个</Text>
                </View>
                {key.expires_at && (
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>过期时间：{formatKeyDate(key.expires_at)}</Text>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: key.is_active ? '#F59E0B15' : Colors.primary + '15' }}
                  onPress={() => handleToggleActive(key)}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: key.is_active ? '#F59E0B' : Colors.primary }}>
                    {key.is_active ? '停用' : '启用'}
                  </Text>
                </Pressable>
                <Pressable
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: '#EF444415' }}
                  onPress={() => setDeleteTarget(key)}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#EF4444' }}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* 创建 Modal */}
      <Modal visible={createVisible} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setCreateVisible(false)}>
          <Pressable style={[budgetStyles.content, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>创建 API Key</Text>
            <View style={[budgetStyles.field, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Key 名称</Text>
              <TextInput
                style={{ color: colors.text, fontSize: 14, fontWeight: '500', textAlign: 'right', flex: 1 }}
                value={keyName}
                onChangeText={setKeyName}
                placeholder="如：生产环境主 Key"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: 12 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>过期时间</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {EXPIRY_OPTIONS.map((opt, idx) => (
                  <Pressable
                    key={idx}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      borderWidth: 1,
                      backgroundColor: expiryIdx === idx ? Colors.primary + '15' : 'transparent',
                      borderColor: expiryIdx === idx ? Colors.primary : colors.border,
                    }}
                    onPress={() => setExpiryIdx(idx)}
                  >
                    <Text style={{ fontSize: 12, fontWeight: expiryIdx === idx ? '600' : '400', color: expiryIdx === idx ? Colors.primary : colors.textSecondary }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setCreateVisible(false)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: Colors.primary }]} onPress={handleCreate} disabled={creating}>
                {creating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 创建成功 Modal — 明文 Key */}
      <Modal visible={createdKey !== null} transparent animationType="fade">
        <View style={budgetStyles.overlay}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <FontAwesome name="check-circle" size={36} color={Colors.primary} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={[budgetStyles.title, { color: colors.text }]}>API Key 创建成功</Text>
            <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.text }} selectable numberOfLines={1} ellipsizeMode="middle">
                {createdKey?.key}
              </Text>
            </View>
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, marginBottom: 12, backgroundColor: copied ? Colors.liability + '15' : Colors.primary + '15' }}
              onPress={handleCopy}
            >
              <FontAwesome name={copied ? 'check' : 'clipboard'} size={14} color={copied ? Colors.liability : Colors.primary} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: copied ? Colors.liability : Colors.primary, marginLeft: 6 }}>
                {copied ? '已复制' : '复制'}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 8, backgroundColor: '#FEF3C7' }}>
              <FontAwesome name="exclamation-triangle" size={14} color="#D97706" />
              <Text style={{ flex: 1, fontSize: 13, color: '#92400E', marginLeft: 8 }}>请立即复制保存此 Key，关闭后无法再次查看！</Text>
            </View>
            <Pressable
              style={{ paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 16, backgroundColor: Colors.primary }}
              onPress={() => setCreatedKey(null)}
            >
              <Text style={{ fontWeight: '600', color: '#FFF' }}>我已保存，关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除 API Key</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              删除「{deleteTarget?.name}」后，关联的 {deleteTarget?.plugin_count ?? 0} 个插件将一并删除，是否继续？
            </Text>
            <View style={budgetStyles.btns}>
              <Pressable style={[budgetStyles.btn, { backgroundColor: colors.border }]} onPress={() => setDeleteTarget(null)}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]} onPress={handleDelete}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}
