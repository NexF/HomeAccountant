import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  importService,
  type ImportUploadResponse,
  type ImportHistoryItem,
} from '@/services/importService';
import { ImportPreview, ImportHistory } from '@/features/import';

export default function DataImportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
  const { currentBook } = useBookStore();
  const bookId = currentBook?.id;

  const [uploadResult, setUploadResult] = useState<ImportUploadResponse | null>(null);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const loadHistory = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await importService.history(bookId);
      setHistory(res.data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (isDesktop) {
      router.back();
      return;
    }
    loadHistory();
  }, [isDesktop, loadHistory]);

  const handleUpload = async () => {
    if (!bookId) {
      showToast('请先选择账本');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      setUploading(true);
      const file = result.assets[0];
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const resp = await fetch(file.uri);
        const blob = await resp.blob();
        formData.append('file', blob, file.name);
      } else {
        formData.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        } as any);
      }
      const res = await importService.upload(bookId, formData);
      setUploadResult(res.data);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '上传失败';
      showToast(typeof msg === 'string' ? msg : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImport = async (taskId: string) => {
    if (!bookId) return;
    try {
      await importService.delete(bookId, taskId);
      showToast('已撤销');
      await loadHistory();
    } catch {
      showToast('撤销失败');
    }
  };

  if (isDesktop) return null;

  // Preview mode
  if (uploadResult && bookId) {
    return (
      <View style={s.container}>
        <ImportPreview
          bookId={bookId}
          data={uploadResult}
          onDone={() => {
            setUploadResult(null);
            loadHistory();
          }}
          onCancel={() => setUploadResult(null)}
        />
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <FontAwesome name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>数据导入</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Upload area */}
        <Pressable
          style={[s.uploadArea, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12 }}>正在上传解析...</Text>
            </>
          ) : (
            <>
              <View style={[s.uploadIcon, { backgroundColor: Colors.primary + '12' }]}>
                <FontAwesome name="cloud-upload" size={32} color={Colors.primary} />
              </View>
              <Text style={[s.uploadTitle, { color: colors.text }]}>上传微信账单</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>
                支持微信「账单 → 导出账单」功能导出的 .xlsx 文件
              </Text>
              <View style={[s.uploadBtn, { backgroundColor: Colors.primary }]}>
                <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>选择文件</Text>
              </View>
            </>
          )}
        </Pressable>

        {/* History */}
        {loadingHistory ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <ImportHistory items={history} onDelete={handleDeleteImport} />
        )}
      </ScrollView>

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
  content: { padding: 16, gap: 20, paddingBottom: 80 },
  uploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  uploadBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
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
