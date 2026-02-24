import React, { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBookStore } from '@/stores/bookStore';
import { useBreakpoint } from '@/hooks/useBreakpoint';

type BookSwitcherProps = {
  onCreateBook: () => void;
  onOpenSettings: () => void;
  compact?: boolean;
};

export function BookSwitcher({ onCreateBook, onOpenSettings, compact }: BookSwitcherProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const { books, currentBook, setCurrentBook } = useBookStore();
  const [open, setOpen] = useState(false);

  const bookList = (
    <>
      {books.map((book) => {
        const selected = book.id === currentBook?.id;
        return (
          <Pressable
            key={book.id}
            style={[
              isDesktop ? dStyles.bookItem : mStyles.bookItem,
              selected && { backgroundColor: colorScheme === 'dark' ? '#312E81' : '#EEF2FF' },
            ]}
            onPress={() => {
              setCurrentBook(book);
              setOpen(false);
            }}
          >
            <View style={s.bookItemLeft}>
              {selected && (
                <FontAwesome name="check" size={12} color={Colors.primary} style={{ marginRight: 8 }} />
              )}
              <Text
                style={[
                  s.bookName,
                  { color: selected ? Colors.primary : colors.text },
                  selected && { fontWeight: '600' },
                ]}
                numberOfLines={1}
              >
                {book.name}
              </Text>
            </View>
            <Text style={s.roleTag}>{book.role === 'admin' ? '管理员' : '成员'}</Text>
          </Pressable>
        );
      })}

      <View style={[s.divider, { backgroundColor: colors.border }]} />

      <Pressable
        style={isDesktop ? dStyles.actionItem : mStyles.actionItem}
        onPress={() => {
          onCreateBook();
          setOpen(false);
        }}
      >
        <FontAwesome name="plus" size={14} color={Colors.primary} />
        <Text style={[s.actionText, { color: Colors.primary }]}>创建新账本</Text>
      </Pressable>
      <Pressable
        style={isDesktop ? dStyles.actionItem : mStyles.actionItem}
        onPress={() => {
          onOpenSettings();
          setOpen(false);
        }}
      >
        <FontAwesome name="cog" size={14} color={Colors.primary} />
        <Text style={[s.actionText, { color: Colors.primary }]}>账本设置</Text>
      </Pressable>
    </>
  );

  // 桌面端：Dropdown
  if (isDesktop) {
    return (
      <View style={dStyles.container}>
        <Pressable
          style={[dStyles.trigger, { borderColor: colors.border }]}
          onPress={() => setOpen(!open)}
        >
          <FontAwesome name="book" size={14} color={Colors.primary} style={{ marginRight: 8 }} />
          <Text style={[dStyles.currentName, { color: colors.text }]} numberOfLines={1}>
            {currentBook?.name ?? '选择账本'}
          </Text>
          <FontAwesome
            name={open ? 'chevron-up' : 'chevron-down'}
            size={10}
            color={colors.textSecondary}
          />
        </Pressable>

        {open && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View
              style={[
                dStyles.dropdown,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  shadowColor: '#000',
                },
              ]}
            >
              {bookList}
            </View>
          </>
        )}
      </View>
    );
  }

  // 移动端：BottomSheet Modal
  return (
    <View>
      <Pressable
        style={compact ? cStyles.trigger : [mStyles.trigger, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => setOpen(true)}
      >
        <FontAwesome name="book" size={compact ? 12 : 14} color={Colors.primary} style={{ marginRight: compact ? 6 : 8 }} />
        <Text
          style={compact ? [cStyles.currentName, { color: colors.text }] : [mStyles.currentName, { color: colors.text }]}
          numberOfLines={1}
        >
          {currentBook?.name ?? '选择账本'}
        </Text>
        <FontAwesome name="chevron-down" size={compact ? 8 : 10} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={mStyles.overlay} onPress={() => setOpen(false)}>
          <Pressable
            style={[mStyles.sheet, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[mStyles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[mStyles.sheetTitle, { color: colors.text }]}>切换账本</Text>
              <Pressable onPress={() => setOpen(false)}>
                <FontAwesome name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            {bookList}
            <View style={{ height: Platform.OS === 'ios' ? 34 : 16 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// 共享样式
const s = StyleSheet.create({
  bookItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bookName: {
    fontSize: 14,
    flex: 1,
  },
  roleTag: {
    fontSize: 12,
    color: '#9CA3AF',
    marginLeft: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 10,
  },
});

// 桌面端样式
const dStyles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom: 8,
    zIndex: 100,
  },
  trigger: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  currentName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  dropdown: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 101,
  },
  bookItem: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginHorizontal: 4,
    borderRadius: 6,
  },
  actionItem: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginHorizontal: 4,
    borderRadius: 6,
  },
});

// 移动端紧凑样式（嵌入 header）
const cStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(79,70,229,0.08)',
  },
  currentName: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 120,
    marginRight: 4,
  },
});

// 移动端样式
const mStyles = StyleSheet.create({
  trigger: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  currentName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  bookItem: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  actionItem: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
});
