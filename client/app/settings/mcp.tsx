import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  apiKeyService,
  type ApiKeyResponse,
} from '@/services/apiKeyService';

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

function getServerUrl(): string {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}

export default function MCPScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
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

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const serverUrl = getServerUrl();
  const activeKey = keys[0];
  const bookId = currentBook?.id ?? '';

  const buildClaudeConfig = () => {
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

  const buildCursorConfig = () => {
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

  if (isDesktop) {
    router.back();
    return null;
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>MCP 服务</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollContent}>
          {/* 连接配置 */}
          <View style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.cardTitleRow}>
              <FontAwesome name="plug" size={16} color={Colors.primary} />
              <Text style={[s.cardTitle, { color: colors.text }]}>连接配置</Text>
            </View>

            <View style={[s.configRow, { borderBottomColor: colors.border }]}>
              <Text style={[s.configLabel, { color: colors.textSecondary }]}>服务器地址</Text>
              <Text style={[s.configValue, { color: colors.text }]} numberOfLines={1}>{serverUrl}</Text>
            </View>
            <View style={[s.configRow, { borderBottomColor: colors.border }]}>
              <Text style={[s.configLabel, { color: colors.textSecondary }]}>API Key</Text>
              {activeKey ? (
                <Text style={[s.configValue, { color: colors.text }]}>{activeKey.key_prefix}...</Text>
              ) : (
                <Pressable onPress={() => router.push('/settings/api-keys' as any)}>
                  <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: '500' }}>去创建</Text>
                </Pressable>
              )}
            </View>
            <View style={[s.configRow, { borderBottomWidth: 0 }]}>
              <Text style={[s.configLabel, { color: colors.textSecondary }]}>账本 ID</Text>
              <Text style={[s.configValue, { color: bookId ? colors.text : colors.textSecondary }]} numberOfLines={1}>
                {bookId || '未选择账本'}
              </Text>
            </View>
          </View>

          {/* 快速配置 */}
          <View style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.cardTitleRow}>
              <FontAwesome name="clipboard" size={16} color={Colors.primary} />
              <Text style={[s.cardTitle, { color: colors.text }]}>快速配置</Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
              复制以下 JSON 配置到对应客户端的设置文件中
            </Text>

            {/* Claude Desktop */}
            <Text style={[s.configSectionLabel, { color: colors.text }]}>Claude Desktop</Text>
            <View style={[s.codeBlock, { backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border }]}>
              <Text style={[s.codeText, { color: colors.text }]} selectable numberOfLines={12}>
                {buildClaudeConfig()}
              </Text>
            </View>
            <Pressable
              style={[s.copyBtn, { backgroundColor: copiedId === 'claude' ? Colors.liability + '15' : Colors.primary + '15' }]}
              onPress={() => handleCopy(buildClaudeConfig(), 'claude')}
            >
              <FontAwesome name={copiedId === 'claude' ? 'check' : 'clipboard'} size={14} color={copiedId === 'claude' ? Colors.liability : Colors.primary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: copiedId === 'claude' ? Colors.liability : Colors.primary, marginLeft: 6 }}>
                {copiedId === 'claude' ? '已复制' : '复制 Claude 配置'}
              </Text>
            </Pressable>

            {/* Cursor */}
            <Text style={[s.configSectionLabel, { color: colors.text, marginTop: 16 }]}>Cursor</Text>
            <View style={[s.codeBlock, { backgroundColor: colorScheme === 'dark' ? '#111827' : '#F3F4F6', borderColor: colors.border }]}>
              <Text style={[s.codeText, { color: colors.text }]} selectable numberOfLines={12}>
                {buildCursorConfig()}
              </Text>
            </View>
            <Pressable
              style={[s.copyBtn, { backgroundColor: copiedId === 'cursor' ? Colors.liability + '15' : Colors.primary + '15' }]}
              onPress={() => handleCopy(buildCursorConfig(), 'cursor')}
            >
              <FontAwesome name={copiedId === 'cursor' ? 'check' : 'clipboard'} size={14} color={copiedId === 'cursor' ? Colors.liability : Colors.primary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: copiedId === 'cursor' ? Colors.liability : Colors.primary, marginLeft: 6 }}>
                {copiedId === 'cursor' ? '已复制' : '复制 Cursor 配置'}
              </Text>
            </Pressable>
          </View>

          {/* 可用 Tools */}
          <View style={[s.card, { backgroundColor: colors.card }]}>
            <View style={s.cardTitleRow}>
              <FontAwesome name="wrench" size={16} color={Colors.primary} />
              <Text style={[s.cardTitle, { color: colors.text }]}>可用 Tools</Text>
              <View style={[s.toolCountBadge, { backgroundColor: Colors.primary + '15' }]}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.primary }}>{MCP_TOOLS.length}</Text>
              </View>
            </View>

            {MCP_TOOLS.map((tool, idx) => (
              <View
                key={tool.name}
                style={[
                  s.toolRow,
                  idx < MCP_TOOLS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                ]}
              >
                <View style={[s.toolIcon, { backgroundColor: tool.color + '15' }]}>
                  <FontAwesome name={tool.icon} size={14} color={tool.color} />
                </View>
                <View style={s.toolInfo}>
                  <Text style={[s.toolName, { color: colors.text }]}>{tool.name}</Text>
                  <Text style={[s.toolDesc, { color: colors.textSecondary }]}>{tool.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

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
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 80 },
  card: { borderRadius: 12, padding: 16 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', flex: 1 },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  configLabel: { fontSize: 14 },
  configValue: { fontSize: 14, fontWeight: '500', textAlign: 'right', flex: 1, marginLeft: 16 },
  configSectionLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  codeBlock: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  codeText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  toolCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  toolIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolInfo: { flex: 1 },
  toolName: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolDesc: { fontSize: 12, marginTop: 2 },
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
