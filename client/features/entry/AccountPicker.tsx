import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  useAccountStore,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  type AccountType,
} from '@/stores/accountStore';
import type { AccountTreeNode } from '@/services/accountService';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (account: AccountTreeNode) => void;
  /** 限定可选类型，不传则全部可选 */
  allowedTypes?: AccountType[];
  /** 选中的科目 ID */
  selectedId?: string;
  bookId?: string;
};

function AccountItem({
  node,
  depth,
  selectedId,
  onSelect,
  typeColor,
}: {
  node: AccountTreeNode;
  depth: number;
  selectedId?: string;
  onSelect: (node: AccountTreeNode) => void;
  typeColor: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isSelected = node.id === selectedId;
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isLeaf = node.is_leaf ?? !hasChildren;

  return (
    <>
      <Pressable
        style={[
          styles.item,
          { paddingLeft: 16 + depth * 20 },
          isSelected && { backgroundColor: Colors.primary + '12' },
          !isLeaf && styles.parentItem,
        ]}
        onPress={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          if (isLeaf) {
            onSelect(node);
          }
        }}
      >
        {hasChildren ? (
          <FontAwesome
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={10}
            color={colors.textSecondary}
            style={styles.chevron}
          />
        ) : (
          <View style={styles.chevron} />
        )}
        <FontAwesome
          name={(node.icon as any) || 'circle-o'}
          size={14}
          color={isLeaf ? typeColor : colors.textSecondary}
          style={styles.itemIcon}
        />
        <Text
          style={[
            styles.itemName,
            !isLeaf && { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
            isSelected && { color: Colors.primary, fontWeight: '600' },
          ]}
        >
          {node.name}
        </Text>
        {!isLeaf && (
          <Text style={[styles.parentHint, { color: colors.textSecondary }]}>
            {node.children.length}个子科目
          </Text>
        )}
        {isSelected && isLeaf && (
          <FontAwesome name="check" size={14} color={Colors.primary} />
        )}
      </Pressable>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <AccountItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            typeColor={typeColor}
          />
        ))}
    </>
  );
}

const TYPE_COLORS: Record<AccountType, string> = {
  asset: Colors.asset,
  liability: Colors.liability,
  equity: Colors.primary,
  income: '#F59E0B',
  expense: '#8B5CF6',
};

export default function AccountPicker({
  visible,
  onClose,
  onSelect,
  allowedTypes,
  selectedId,
  bookId,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { tree, fetchTree, currentBookId } = useAccountStore();
  const [activeTab, setActiveTab] = useState<AccountType>(
    allowedTypes?.[0] ?? 'expense'
  );

  useEffect(() => {
    const bid = bookId ?? currentBookId;
    if (visible && bid && !tree) {
      fetchTree(bid);
    }
  }, [visible, bookId, currentBookId]);

  useEffect(() => {
    if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(activeTab)) {
      setActiveTab(allowedTypes[0]);
    }
  }, [allowedTypes]);

  const types = allowedTypes ?? ACCOUNT_TYPE_ORDER;
  const currentAccounts = tree ? tree[activeTab] : [];

  const handleSelect = (node: AccountTreeNode) => {
    const isLeaf = node.is_leaf ?? (node.children.length === 0);
    if (!isLeaf) return;
    onSelect(node);
    onClose();
  };

  const content = (
    <View
      style={[
        styles.sheet,
        {
          backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>选择科目</Text>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <FontAwesome name="close" size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* Type tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {types.map((type) => {
          const active = activeTab === type;
          return (
            <Pressable
              key={type}
              style={[
                styles.tab,
                active && {
                  backgroundColor: TYPE_COLORS[type] + '18',
                  borderColor: TYPE_COLORS[type],
                },
              ]}
              onPress={() => setActiveTab(type)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? TYPE_COLORS[type] : colors.textSecondary },
                ]}
              >
                {ACCOUNT_TYPE_LABELS[type]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView style={styles.list}>
        {currentAccounts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>暂无科目</Text>
          </View>
        ) : (
          currentAccounts.map((node) => (
            <AccountItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
              typeColor={TYPE_COLORS[activeTab]}
            />
          ))
        )}
      </ScrollView>
    </View>
  );

  if (Platform.OS === 'web') {
    if (!visible) return null;
    return (
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={styles.webSheet}>
          {content}
        </Pressable>
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()}>{content}</Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    ...(Platform.OS === 'web'
      ? ({
          position: 'fixed' as any,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          justifyContent: 'center',
          alignItems: 'center',
        } as any)
      : {}),
  },
  webSheet: {
    width: '90%',
    maxWidth: 480,
    maxHeight: '80%',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    minHeight: 400,
    ...(Platform.OS === 'web'
      ? { borderRadius: 16, maxHeight: '100%' }
      : {}),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexGrow: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabsContent: {
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  parentItem: {
    opacity: 0.75,
  },
  parentHint: {
    fontSize: 11,
    marginRight: 4,
  },
  chevron: {
    width: 16,
    textAlign: 'center',
    marginRight: 4,
  },
  itemIcon: {
    width: 22,
    textAlign: 'center',
    marginRight: 8,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
});
