import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import * as Clipboard from 'expo-clipboard';
import { apiKeyService, type ApiKeyResponse } from '@/services/apiKeyService';
import { styles } from '@/features/profile/styles';
import type { DetailPane } from '@/features/profile/types';

const MCP_TOOLS = [
  { name: 'create_entries', desc: '创建记账分录', icon: 'plus-circle' as const, color: '#10B981' },
  { name: 'list_entries', desc: '查询分录列表', icon: 'list' as const, color: '#3B82F6' },
  { name: 'get_entry', desc: '获取分录详情', icon: 'file-text-o' as const, color: '#6366F1' },
  { name: 'delete_entry', desc: '删除分录', icon: 'trash-o' as const, color: '#EF4444' },
  { name: 'get_balance_sheet', desc: '资产负债表', icon: 'balance-scale' as const, color: '#F59E0B' },
  { name: 'get_income_statement', desc: '损益表', icon: 'line-chart' as const, color: '#8B5CF6' },
  { name: 'get_dashboard', desc: '仪表盘概览', icon: 'dashboard' as const, color: '#EC4899' },
  { name: 'sync_balance', desc: '余额同步', icon: 'refresh' as const, color: '#14B8A6' },
  { name: 'list_accounts', desc: '科目列表', icon: 'sitemap' as const, color: '#F97316' },
  { name: 'list_plugins', desc: '插件列表', icon: 'puzzle-piece' as const, color: '#6B7280' },
];

function getMCPServerUrl(): string {
  if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
  return 'http://localhost:8000';
}

export default function MCPPane({ onNavigate }: { onNavigate?: (pane: DetailPane) => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook } = useBookStore();

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const fetchKeys = useCallback(async () => {
    try {
      const { data } = await apiKeyService.list();
      setKeys(data.filter((k) => k.is_active));
    } catch {
      showToast('加载 API Key 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const serverUrl = getMCPServerUrl();
  const activeKey = keys[0];
  const bookId = currentBook?.id ?? '';

  const buildConfig = () => {
    return JSON.stringify(
      {
        mcpServers: {
          'home-accountant': {
            command: 'python',
            args: ['-m', 'mcp_server'],
            env: {
              HA_SERVER_URL: serverUrl,
              HA_AUTH_TYPE: 'api_key',
              HA_API_KEY: activeKey ? `${activeKey.key_prefix}...（替换为完整 Key）` : '（请先创建 API Key）',
              HA_DEFAULT_BOOK_ID: bookId || '（请先选择账本）',
            },
          },
        },
      },
      null,
      2
    );
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      showToast('已复制到剪贴板');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showToast('复制失败');
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
      <View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent' }]}>
        <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>MCP 服务</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12 }}>
        {/* 连接配置 */}
        <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <FontAwesome name="plug" size={16} color={Colors.primary} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>连接配置</Text>
          </View>

          <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.formLabel, { color: colors.textSecondary }]}>服务器地址</Text>
            <Text style={[styles.formValue, { color: colors.text }]} numberOfLines={1}>{serverUrl}</Text>
          </View>
          <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.formLabel, { color: colors.textSecondary }]}>API Key</Text>
            {activeKey ? (
              <Text style={[styles.formValue, { color: colors.text }]}>{activeKey.key_prefix}...</Text>
            ) : (
              <Pressable onPress={() => onNavigate ? onNavigate('api-keys') : router.push('/settings/api-keys' as any)}>
                <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: '500' }}>去创建</Text>
              </Pressable>
            )}
          </View>
          <View style={[styles.formRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.formLabel, { color: colors.textSecondary }]}>账本 ID</Text>
            <Text style={[styles.formValue, { color: bookId ? colors.text : colors.textSecondary }]} numberOfLines={1}>
              {bookId || '未选择账本'}
            </Text>
          </View>
        </View>

        {/* 快速配置 */}
        <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <FontAwesome name="clipboard" size={16} color={Colors.primary} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>快速配置</Text>
          </View>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
            复制以下 JSON 配置到对应客户端的设置文件中
          </Text>

          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Claude Desktop</Text>
          <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border, marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.text, lineHeight: 18 }} selectable numberOfLines={12}>
              {buildConfig()}
            </Text>
          </View>
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, backgroundColor: copiedId === 'claude' ? Colors.liability + '15' : Colors.primary + '15' }}
            onPress={() => handleCopy(buildConfig(), 'claude')}
          >
            <FontAwesome name={copiedId === 'claude' ? 'check' : 'clipboard'} size={14} color={copiedId === 'claude' ? Colors.liability : Colors.primary} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: copiedId === 'claude' ? Colors.liability : Colors.primary, marginLeft: 6 }}>
              {copiedId === 'claude' ? '已复制' : '复制 Claude 配置'}
            </Text>
          </Pressable>

          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 16 }}>Cursor</Text>
          <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border, marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.text, lineHeight: 18 }} selectable numberOfLines={12}>
              {buildConfig()}
            </Text>
          </View>
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, backgroundColor: copiedId === 'cursor' ? Colors.liability + '15' : Colors.primary + '15' }}
            onPress={() => handleCopy(buildConfig(), 'cursor')}
          >
            <FontAwesome name={copiedId === 'cursor' ? 'check' : 'clipboard'} size={14} color={copiedId === 'cursor' ? Colors.liability : Colors.primary} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: copiedId === 'cursor' ? Colors.liability : Colors.primary, marginLeft: 6 }}>
              {copiedId === 'cursor' ? '已复制' : '复制 Cursor 配置'}
            </Text>
          </Pressable>
        </View>

        {/* 可用 Tools */}
        <View style={[styles.formCard, { backgroundColor: colors.card, padding: 16, marginBottom: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <FontAwesome name="wrench" size={16} color={Colors.primary} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 }}>可用 Tools</Text>
            <View style={[styles.directionBadge, { backgroundColor: Colors.primary + '15' }]}>
              <Text style={[styles.directionText, { color: Colors.primary }]}>{MCP_TOOLS.length}</Text>
            </View>
          </View>

          {MCP_TOOLS.map((tool, idx) => (
            <View
              key={tool.name}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                gap: 12,
                borderBottomWidth: idx < MCP_TOOLS.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: tool.color + '15' }}>
                <FontAwesome name={tool.icon} size={14} color={tool.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{tool.name}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{tool.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Toast */}
      {toastMsg ? (
        <View style={{ position: 'absolute', top: 16, left: 24, right: 24, backgroundColor: toastMsg.includes('失败') || toastMsg.includes('错误') ? '#EF4444' : Colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>{toastMsg}</Text>
        </View>
      ) : null}
    </View>
  );
}
