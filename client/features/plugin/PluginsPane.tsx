import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { pluginService, type PluginResponse } from '@/services/pluginService';
import { styles, budgetStyles } from '@/features/profile/styles';
import { AccountPicker } from '@/features/entry';
import type { AccountTreeNode } from '@/services/accountService';
import PluginConfigForm, { type PickerRequest } from './PluginConfigForm';

const PLUGIN_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle: { label: '空闲', color: '#9CA3AF' },
  running: { label: '同步中', color: '#3B82F6' },
  success: { label: '成功', color: '#10B981' },
  failed: { label: '失败', color: '#EF4444' },
};

const PLUGIN_TYPE_LABEL: Record<string, string> = {
  entry: '记账',
  balance: '余额同步',
  both: '记账 + 余额',
};

function formatPluginDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatPluginDateTime(iso: string | null) {
  if (!iso) return '从未同步';
  return new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function PluginsPane() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [loading, setLoading] = useState(true);
  const [plugins, setPlugins] = useState<PluginResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PluginResponse | null>(null);
  const [configPluginId, setConfigPluginId] = useState<string | null>(null);
  const [configDetail, setConfigDetail] = useState<PluginResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // AccountPicker 状态（提升到顶层渲染，避免被 overflow:hidden 裁切）
  const [pickerRequest, setPickerRequest] = useState<PickerRequest>(null);
  const [pickedAccount, setPickedAccount] = useState<{ fieldKey: string; account: AccountTreeNode } | null>(null);

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

  useEffect(() => { fetchPlugins(); }, [fetchPlugins]);

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

  const handleOpenConfig = async (pluginId: string) => {
    setConfigPluginId(pluginId);
    setConfigLoading(true);
    try {
      const { data } = await pluginService.get(pluginId);
      setConfigDetail(data);
    } catch {
      showToast('加载配置失败');
      setConfigPluginId(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const handleCloseConfig = () => {
    setConfigPluginId(null);
    setConfigDetail(null);
    setPickerRequest(null);
    setPickedAccount(null);
  };

  const handleSaveConfig = async (pluginId: string, config: Record<string, any>) => {
    setConfigSaving(true);
    try {
      await pluginService.updateConfig(pluginId, config);
      handleCloseConfig();
      await fetchPlugins();
      showToast('配置已保存');
    } catch {
      showToast('保存失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const handlePickerSelect = (account: AccountTreeNode) => {
    if (pickerRequest) {
      setPickedAccount({ fieldKey: pickerRequest.fieldKey, account });
    }
    setPickerRequest(null);
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
      <View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>插件管理</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {plugins.length === 0 ? (
          <View style={styles.acctEmpty}>
            <FontAwesome name="puzzle-piece" size={40} color={colors.textSecondary} />
            <Text style={[styles.acctEmptyText, { color: colors.textSecondary }]}>暂无插件</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>通过 API Key 注册插件后会显示在此处</Text>
          </View>
        ) : (
          plugins.map((plugin) => {
            const status = PLUGIN_STATUS_CONFIG[plugin.last_sync_status] ?? PLUGIN_STATUS_CONFIG.idle;
            const isConfigOpen = configPluginId === plugin.id;
            return (
              <View
                key={plugin.id}
                style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 12 }]}
              >
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FontAwesome name="puzzle-piece" size={16} color={Colors.primary} />
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }} numberOfLines={1}>{plugin.display_name || plugin.name}</Text>
                  {plugin.has_config && (
                    <View style={[ps.configBadge, { backgroundColor: plugin.is_configured ? '#10B98115' : '#F59E0B15' }]}>
                      <View style={[ps.configDot, { backgroundColor: plugin.is_configured ? '#10B981' : '#F59E0B' }]} />
                      <Text style={{ fontSize: 11, fontWeight: '600', color: plugin.is_configured ? '#10B981' : '#F59E0B' }}>
                        {plugin.is_configured ? '已配置' : '待配置'}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.directionBadge, { backgroundColor: status.color + '15' }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.color, marginRight: 4 }} />
                    <Text style={[styles.directionText, { color: status.color }]}>
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
                <View style={{ gap: 4, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>类型：{PLUGIN_TYPE_LABEL[plugin.type] ?? plugin.type}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>同步 {plugin.sync_count} 次</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>最后同步：{formatPluginDateTime(plugin.last_sync_at)}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>创建于 {formatPluginDate(plugin.created_at)}</Text>
                  </View>
                </View>

                {/* Error Message */}
                {plugin.last_sync_status === 'failed' && plugin.last_error_message && (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 10, borderRadius: 8, backgroundColor: '#FEF2F2', marginBottom: 8 }}>
                    <FontAwesome name="exclamation-circle" size={12} color="#EF4444" />
                    <Text style={{ flex: 1, fontSize: 12, color: '#991B1B', marginLeft: 6 }} numberOfLines={3}>
                      {plugin.last_error_message}
                    </Text>
                  </View>
                )}

                {/* Config Form (inline expand) */}
                {isConfigOpen && configLoading && (
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                  </View>
                )}
                {isConfigOpen && !configLoading && configDetail?.config_schema && (
                  <PluginConfigForm
                    schema={configDetail.config_schema}
                    config={configDetail.config}
                    onSave={(cfg) => handleSaveConfig(plugin.id, cfg)}
                    onCancel={handleCloseConfig}
                    loading={configSaving}
                    onPickerRequest={setPickerRequest}
                    pickedAccount={pickedAccount}
                  />
                )}

                {/* Actions */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {plugin.has_config && !isConfigOpen && (
                    <Pressable
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: Colors.primary + '15' }}
                      onPress={() => handleOpenConfig(plugin.id)}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.primary }}>配置</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: '#EF444415' }}
                    onPress={() => setDeleteTarget(plugin)}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#EF4444' }}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* 删除确认 Modal */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <Pressable style={budgetStyles.overlay} onPress={() => setDeleteTarget(null)}>
          <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
            <Text style={[budgetStyles.title, { color: colors.text }]}>删除插件</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
              确定要删除「{deleteTarget?.display_name || deleteTarget?.name}」吗？此操作不可撤销。
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

      {/* AccountPicker（渲染在顶层，确保浮在整个屏幕上） */}
      <AccountPicker
        visible={pickerRequest !== null}
        onClose={() => setPickerRequest(null)}
        onSelect={handlePickerSelect}
        selectedId={pickerRequest?.selectedId}
        bookId={pickerRequest?.bookId}
      />

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const ps = StyleSheet.create({
  configBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  configDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
