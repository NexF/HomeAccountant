import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, StatusBar } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { pluginService, type PluginResponse } from '@/services/pluginService';
import { AccountPicker } from '@/features/entry';
import type { AccountTreeNode } from '@/services/accountService';
import PluginConfigForm, { type PickerRequest } from '@/features/plugin/PluginConfigForm';

export default function PluginConfigScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [plugin, setPlugin] = useState<PluginResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [pickerRequest, setPickerRequest] = useState<PickerRequest>(null);
  const [pickedAccount, setPickedAccount] = useState<{ fieldKey: string; account: AccountTreeNode } | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  useEffect(() => {
    if (isDesktop) {
      router.back();
      return;
    }
    if (!id) return;
    (async () => {
      try {
        const { data } = await pluginService.get(id);
        setPlugin(data);
      } catch {
        showToast('加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isDesktop]);

  const handleSave = async (config: Record<string, any>) => {
    if (!plugin) return;
    setSaving(true);
    try {
      await pluginService.updateConfig(plugin.id, config);
      showToast('配置已保存');
      setTimeout(() => router.back(), 500);
    } catch {
      showToast('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePickerSelect = (account: AccountTreeNode) => {
    if (pickerRequest) {
      setPickedAccount({ fieldKey: pickerRequest.fieldKey, account });
    }
    setPickerRequest(null);
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>
          {plugin ? `${plugin.display_name || plugin.name} 配置` : '插件配置'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : !plugin?.config_schema ? (
        <View style={s.center}>
          <Text style={{ color: colors.textSecondary }}>该插件无配置项</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <PluginConfigForm
            schema={plugin.config_schema}
            config={plugin.config}
            onSave={handleSave}
            onCancel={() => router.back()}
            loading={saving}
            onPickerRequest={setPickerRequest}
            pickedAccount={pickedAccount}
          />
        </ScrollView>
      )}

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
        <View
          style={[
            s.toast,
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

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : (StatusBar.currentHeight ?? 52) + 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
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
