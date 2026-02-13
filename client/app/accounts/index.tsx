import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import {
  useAccountStore,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  type AccountType,
} from '@/stores/accountStore';
import type { AccountTreeNode } from '@/services/accountService';
import { accountService } from '@/services/accountService';

const TYPE_COLORS: Record<AccountType, string> = {
  asset: Colors.asset,
  liability: Colors.liability,
  equity: Colors.primary,
  income: '#F59E0B',
  expense: '#8B5CF6',
};

const DIRECTION_LABEL: Record<string, string> = {
  debit: '借',
  credit: '贷',
};

function AccountRow({
  node,
  depth,
  onPress,
  onDeactivate,
}: {
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onDeactivate: (node: AccountTreeNode) => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <Pressable
        style={[styles.row, { paddingLeft: 16 + depth * 24 }]}
        onPress={() => onPress(node)}
      >
        {hasChildren ? (
          <Pressable onPress={() => setExpanded(!expanded)} style={styles.expandBtn}>
            <FontAwesome
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={10}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : (
          <View style={styles.expandBtn} />
        )}
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: TYPE_COLORS[node.type as AccountType] + '18' },
          ]}
        >
          <FontAwesome
            name={(node.icon as any) || 'circle'}
            size={14}
            color={TYPE_COLORS[node.type as AccountType]}
          />
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowName}>{node.name}</Text>
          <Text style={[styles.rowCode, { color: colors.textSecondary }]}>{node.code}</Text>
        </View>
        <View
          style={[
            styles.directionBadge,
            {
              backgroundColor:
                node.balance_direction === 'debit' ? Colors.asset + '15' : Colors.liability + '15',
            },
          ]}
        >
          <Text
            style={[
              styles.directionText,
              {
                color:
                  node.balance_direction === 'debit' ? Colors.asset : Colors.liability,
              },
            ]}
          >
            {DIRECTION_LABEL[node.balance_direction]}
          </Text>
        </View>
        {!node.is_system && (
          <Pressable
            style={styles.deleteBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              onDeactivate(node);
            }}
          >
            <FontAwesome name="trash-o" size={14} color={colors.textSecondary} />
          </Pressable>
        )}
      </Pressable>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <AccountRow
            key={child.id}
            node={child}
            depth={depth + 1}
            onPress={onPress}
            onDeactivate={onDeactivate}
          />
        ))}
    </>
  );
}

export default function AccountsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const { currentBook, fetchBooks } = useBookStore();
  const { tree, isLoading, fetchTree } = useAccountStore();
  const [activeTab, setActiveTab] = useState<AccountType>('asset');

  useEffect(() => {
    fetchBooks();
  }, []);

  useEffect(() => {
    if (currentBook) {
      fetchTree(currentBook.id);
    }
  }, [currentBook?.id]);

  const handlePress = (node: AccountTreeNode) => {
    router.push(`/accounts/${node.id}` as any);
  };

  const handleDeactivate = async (node: AccountTreeNode) => {
    const doDeactivate = async () => {
      try {
        await accountService.deactivateAccount(node.id);
        if (currentBook) fetchTree(currentBook.id);
      } catch {
        if (Platform.OS === 'web') {
          window.alert('停用失败');
        } else {
          Alert.alert('错误', '停用失败');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`确定要停用「${node.name}」吗？`)) {
        await doDeactivate();
      }
    } else {
      Alert.alert('停用科目', `确定要停用「${node.name}」吗？`, [
        { text: '取消', style: 'cancel' },
        { text: '停用', style: 'destructive', onPress: doDeactivate },
      ]);
    }
  };

  const currentAccounts = tree ? tree[activeTab] : [];

  if (isLoading && !tree) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>科目管理</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabContent}
      >
        {ACCOUNT_TYPE_ORDER.map((type) => {
          const active = activeTab === type;
          return (
            <Pressable
              key={type}
              style={[
                styles.tab,
                active && { backgroundColor: TYPE_COLORS[type] + '18', borderColor: TYPE_COLORS[type] },
              ]}
              onPress={() => setActiveTab(type)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                  active && { fontWeight: '600' },
                ]}
              >
                {ACCOUNT_TYPE_LABELS[type]}
              </Text>
              {tree && (
                <Text
                  style={[
                    styles.tabCount,
                    { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                  ]}
                >
                  {tree[type].length}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Account List */}
      <ScrollView style={styles.list}>
        {currentAccounts.length === 0 ? (
          <View style={styles.empty}>
            <FontAwesome name="folder-open-o" size={40} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              暂无{ACCOUNT_TYPE_LABELS[activeTab]}类科目
            </Text>
          </View>
        ) : (
          currentAccounts.map((node) => (
            <AccountRow
              key={node.id}
              node={node}
              depth={0}
              onPress={handlePress}
              onDeactivate={handleDeactivate}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  tabBar: {
    flexGrow: 0,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  tabContent: {
    gap: 8,
    paddingRight: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  tabText: {
    fontSize: 14,
  },
  tabCount: {
    fontSize: 12,
    opacity: 0.7,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  expandBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rowContent: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowCode: {
    fontSize: 12,
    marginTop: 1,
  },
  directionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  directionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
});
