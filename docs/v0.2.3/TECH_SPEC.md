# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.2.3**
> **创建日期：2026-02-14**
> **基于版本：v0.2.2**
> **状态：规划中**
> **本版本变更：前端科目新增/管理完整闭环**

---

## 1. 技术架构概述

v0.2.3 为纯前端版本，后端 API 和 `accountService` 已完全就绪。核心工作是在科目列表和详情页添加新增科目入口，并将停用操作从列表行移至详情页底部。

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **移动端页面** | `client/app/accounts/index.tsx` | 修改 | `AccountRow` 移除停用按钮 + 新增行内 "+" 按钮 + Header "+" 按钮 + 新增科目 Modal |
| **移动端页面** | `client/app/accounts/[id].tsx` | 修改 | 子科目 section "+" 按钮 + 新增子科目 Modal + 页面底部「停用科目」按钮 |
| **桌面端组件** | `client/features/account/AccountsPane.tsx` | 修改 | `AccountRow` 移除停用按钮 + 新增行内 "+" 按钮 + 标题栏 "+" + 新增科目 Modal；`AccountDetailInline` 子科目 "+" + 底部停用按钮 |

### 1.2 无需变更

| 文件 | 说明 |
|------|------|
| `client/services/accountService.ts` | 已有 `createAccount`、`CreateAccountParams`、`AccountCreateResponse`、`MigrationInfo` 完整类型 |
| `client/stores/accountStore.ts` | 已有 `fetchTree` 刷新方法，无需改动 |
| `server/**` | 后端 `POST /books/{book_id}/accounts` + `DELETE /accounts/{id}` 已完整实现 |

### 1.3 依赖的后端 API

| API | 方法 | 用途 |
|-----|------|------|
| `POST /books/{book_id}/accounts` | `accountService.createAccount(bookId, params)` | 创建科目（含自动迁移） |
| `DELETE /accounts/{account_id}` | `accountService.deactivateAccount(accountId)` | 停用科目 |
| `GET /books/{book_id}/accounts` | `accountService.getAccountTree(bookId)` | 创建后刷新科目树 |

### 1.4 已有类型定义（无需修改）

```typescript
// client/services/accountService.ts — 已存在
export type CreateAccountParams = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  balance_direction: 'debit' | 'credit';
  parent_id?: string;
  icon?: string;
  sort_order?: number;
};

export type MigrationInfo = {
  triggered: boolean;
  fallback_account: { id: string; code: string; name: string } | null;
  migrated_lines_count: number;
  message: string;
};

export type AccountCreateResponse = AccountResponse & {
  migration: MigrationInfo;
};
```

---

## 2. 移动端科目列表页 `accounts/index.tsx`

### 2.1 AccountRow 组件改造

**当前状态**：`AccountRow` 接收 `onPress` + `onDeactivate` 回调，行内有 trash-o 停用按钮。

**改造后**：移除 `onDeactivate` 回调和停用按钮，新增 `onAdd` 回调和 "+" 按钮。

```typescript
// 改造前 Props
{
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onDeactivate: (node: AccountTreeNode) => void;  // ← 移除
}

// 改造后 Props
{
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onAdd: (node: AccountTreeNode) => void;          // ← 新增
}
```

#### 2.1.1 行内 "+" 按钮

替换原有的 trash-o 按钮区域：

```typescript
// 移除：条件渲染的 trash-o 按钮（第 108-118 行）
// {!node.is_system && (
//   <Pressable style={styles.deleteBtn} onPress={(e) => { ... onDeactivate(node) }}>
//     <FontAwesome name="trash-o" size={14} color={colors.textSecondary} />
//   </Pressable>
// )}

// 替换为：始终显示的 "+" 按钮
<Pressable
  style={styles.addBtn}
  onPress={(e) => {
    e.stopPropagation?.();
    onAdd(node);
  }}
>
  <FontAwesome name="plus" size={13} color={Colors.primary} />
</Pressable>
```

#### 2.1.2 递归子组件传递

```typescript
{expanded && hasChildren && node.children.map((child) => (
  <AccountRow
    key={child.id}
    node={child}
    depth={depth + 1}
    onPress={onPress}
    onAdd={onAdd}          // ← 替换 onDeactivate
  />
))}
```

#### 2.1.3 新增样式

```typescript
addBtn: {
  width: 32,
  height: 32,
  alignItems: 'center',
  justifyContent: 'center',
},
```

> 复用原 `deleteBtn` 的尺寸（32x32），仅替换内容。

### 2.2 Header "+" 按钮

替换 Header 右侧的空占位 `<View style={{ width: 36 }} />`：

```typescript
// 当前（第 202 行）：
<View style={{ width: 36 }} />

// 改造后：
<Pressable onPress={handleHeaderAdd} style={styles.backBtn}>
  <FontAwesome name="plus" size={18} color={Colors.primary} />
</Pressable>
```

复用 `backBtn` 样式（36x36 居中），与左侧返回按钮对称。

### 2.3 新增科目 Modal

#### 2.3.1 State 定义

在 `AccountsScreen` 组件中新增：

```typescript
// Modal 控制
const [showCreateModal, setShowCreateModal] = useState(false);
// 父科目（行内 "+" 设置，Header "+" 为 null 代表顶级）
const [createParent, setCreateParent] = useState<AccountTreeNode | null>(null);

// 表单字段
const [createCode, setCreateCode] = useState('');
const [createName, setCreateName] = useState('');
const [createDirection, setCreateDirection] = useState<'debit' | 'credit'>('debit');
const [createIcon, setCreateIcon] = useState('');
const [creating, setCreating] = useState(false);
```

#### 2.3.2 行内 "+" Handler

```typescript
const handleAdd = (node: AccountTreeNode) => {
  setCreateParent(node);
  setCreateCode(`${node.code}-`);
  setCreateName('');
  setCreateDirection(node.balance_direction);
  setCreateIcon('');
  setShowCreateModal(true);
};
```

#### 2.3.3 Header "+" Handler

```typescript
const DEFAULT_DIRECTION: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  expense: 'debit',
};

const handleHeaderAdd = () => {
  setCreateParent(null);  // 顶级科目
  setCreateCode('');
  setCreateName('');
  setCreateDirection(DEFAULT_DIRECTION[activeTab]);
  setCreateIcon('');
  setShowCreateModal(true);
};
```

#### 2.3.4 创建 Handler

```typescript
const handleCreate = async () => {
  if (!currentBook || !createCode.trim() || !createName.trim()) return;
  setCreating(true);
  try {
    const params: CreateAccountParams = {
      code: createCode.trim(),
      name: createName.trim(),
      type: createParent ? (createParent.type as CreateAccountParams['type']) : activeTab,
      balance_direction: createParent ? createParent.balance_direction : createDirection,
      ...(createParent ? { parent_id: createParent.id } : {}),
      ...(createIcon.trim() ? { icon: createIcon.trim() } : {}),
    };

    const { data } = await accountService.createAccount(currentBook.id, params);
    setShowCreateModal(false);
    await fetchTree(currentBook.id);

    // 迁移提示（遵循 DESIGN_GUIDELINES 第 1 节 — 统一 Toast）
    if (data.migration?.triggered) {
      showToast('分录已迁移', data.migration.message, 5000);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.detail || '创建失败';
    showToast('错误', msg);
  } finally {
    setCreating(false);
  }
};
```

#### 2.3.5 Modal UI 结构

```typescript
<Modal visible={showCreateModal} transparent animationType="slide">
  <Pressable
    style={modalStyles.overlay}
    onPress={() => setShowCreateModal(false)}
  >
    <View
      style={[modalStyles.content, { backgroundColor: colors.card }]}
      onStartShouldSetResponder={() => true}  // 阻止点击穿透
    >
      <Text style={[modalStyles.title, { color: colors.text }]}>
        {createParent ? '新增子科目' : '新增科目'}
      </Text>

      {/* 父科目只读标签（仅子科目模式） */}
      {createParent && (
        <View style={modalStyles.readonlyRow}>
          <Text style={[modalStyles.label, { color: colors.textSecondary }]}>父科目</Text>
          <View style={[modalStyles.readonlyBadge, { backgroundColor: Colors.primary + '15' }]}>
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '500' }}>
              {createParent.name}（{createParent.code}）
            </Text>
          </View>
        </View>
      )}

      {/* 类型只读标签 */}
      <View style={modalStyles.readonlyRow}>
        <Text style={[modalStyles.label, { color: colors.textSecondary }]}>类型</Text>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
          {ACCOUNT_TYPE_LABELS[
            createParent ? (createParent.type as AccountType) : activeTab
          ]}
        </Text>
      </View>

      {/* 余额方向 */}
      <View style={modalStyles.readonlyRow}>
        <Text style={[modalStyles.label, { color: colors.textSecondary }]}>余额方向</Text>
        {createParent ? (
          // 子科目模式：锁定
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
            {createParent.balance_direction === 'debit' ? '借方' : '贷方'}
          </Text>
        ) : (
          // 顶级模式：Chip 选择器
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['debit', 'credit'] as const).map((dir) => (
              <Pressable
                key={dir}
                style={[
                  modalStyles.chip,
                  createDirection === dir && {
                    backgroundColor: Colors.primary + '20',
                    borderColor: Colors.primary,
                  },
                ]}
                onPress={() => setCreateDirection(dir)}
              >
                <Text
                  style={[
                    modalStyles.chipText,
                    { color: createDirection === dir ? Colors.primary : colors.textSecondary },
                  ]}
                >
                  {dir === 'debit' ? '借方' : '贷方'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* 编码输入 */}
      <View style={modalStyles.fieldRow}>
        <Text style={[modalStyles.label, { color: colors.textSecondary }]}>编码</Text>
        <TextInput
          style={[modalStyles.input, { color: colors.text, borderColor: colors.border }]}
          value={createCode}
          onChangeText={setCreateCode}
          placeholder={createParent ? `${createParent.code}-01` : '例如 1003'}
          placeholderTextColor={colors.textSecondary}
          autoFocus
        />
      </View>

      {/* 名称输入 */}
      <View style={modalStyles.fieldRow}>
        <Text style={[modalStyles.label, { color: colors.textSecondary }]}>名称</Text>
        <TextInput
          style={[modalStyles.input, { color: colors.text, borderColor: colors.border }]}
          value={createName}
          onChangeText={setCreateName}
          placeholder="科目名称"
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* 图标输入（可选） */}
      <View style={modalStyles.fieldRow}>
        <Text style={[modalStyles.label, { color: colors.textSecondary }]}>图标（可选）</Text>
        <TextInput
          style={[modalStyles.input, { color: colors.text, borderColor: colors.border }]}
          value={createIcon}
          onChangeText={setCreateIcon}
          placeholder="FontAwesome 图标名"
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* 按钮区 */}
      <View style={modalStyles.btnRow}>
        <Pressable
          style={[modalStyles.btn, { backgroundColor: colors.border }]}
          onPress={() => setShowCreateModal(false)}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
        </Pressable>
        <Pressable
          style={[
            modalStyles.btn,
            {
              backgroundColor:
                createCode.trim() && createName.trim() ? Colors.primary : colors.border,
            },
          ]}
          onPress={handleCreate}
          disabled={!createCode.trim() || !createName.trim() || creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>
          )}
        </Pressable>
      </View>
    </View>
  </Pressable>
</Modal>
```

#### 2.3.6 Modal 样式

遵循 DESIGN_GUIDELINES.md 第 10 节 Modal 尺寸规范：

```typescript
const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '85%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 24,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  readonlyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  readonlyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  fieldRow: {
    marginBottom: 12,
  },
  input: {
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

### 2.4 AccountRow 调用变更

```typescript
// 当前：
<AccountRow
  key={node.id}
  node={node}
  depth={0}
  onPress={handlePress}
  onDeactivate={handleDeactivate}   // ← 移除
/>

// 改造后：
<AccountRow
  key={node.id}
  node={node}
  depth={0}
  onPress={handlePress}
  onAdd={handleAdd}                 // ← 新增
/>
```

### 2.5 移除 handleDeactivate

删除 `AccountsScreen` 中的 `handleDeactivate` 函数（第 157-182 行）。停用操作已移至 `accounts/[id].tsx` 详情页。

### 2.6 新增 import

```typescript
import { Modal, TextInput } from 'react-native';  // Modal 和 TextInput 追加
import type { CreateAccountParams } from '@/services/accountService';
```

---

## 3. 移动端科目详情页 `accounts/[id].tsx`

### 3.1 子科目 Section "+" 按钮

#### 3.1.1 改造子科目 section 标题

当前子科目 section 仅在 `account.children.length > 0` 时渲染（第 287 行条件判断）。

**改造后**：始终显示子科目 section，标题右侧添加 "+" 按钮。

```typescript
// 替换第 286-319 行
{/* 子科目 section — 始终显示 */}
<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
  <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 8 }]}>
    {account.children.length > 0
      ? `子科目（${account.children.length}）`
      : '新增子科目'}
  </Text>
  <Pressable
    style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
    onPress={handleAddChild}
  >
    <FontAwesome name="plus" size={13} color={Colors.primary} />
  </Pressable>
</View>
<View style={[styles.card, { backgroundColor: colors.card }]}>
  {account.children.length > 0 ? (
    account.children.map((child) => (
      <Pressable
        key={child.id}
        style={styles.childRow}
        onPress={() => router.push(`/accounts/${child.id}` as any)}
      >
        <FontAwesome name={(child.icon as any) || 'circle-o'} size={14} color={Colors.primary} style={{ width: 24 }} />
        <Text style={styles.childName}>{child.name}</Text>
        <Text style={[styles.childCode, { color: colors.textSecondary }]}>{child.code}</Text>
        <FontAwesome name="chevron-right" size={10} color={colors.textSecondary} style={{ opacity: 0.4 }} />
      </Pressable>
    ))
  ) : (
    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
        点击右侧 ＋ 添加子科目
      </Text>
    </View>
  )}
</View>
```

### 3.2 停用科目按钮（页面底部）

在子科目 section 之后、`</ScrollView>` 之前添加：

```typescript
{/* 停用科目按钮 — 仅非系统科目显示 */}
{!account.is_system && (
  <Pressable
    style={styles.deactivateBtn}
    onPress={handleDeactivate}
  >
    <Text style={styles.deactivateBtnText}>停用科目</Text>
  </Pressable>
)}
```

#### 3.2.1 停用按钮样式

```typescript
deactivateBtn: {
  height: 44,
  borderRadius: 10,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#FEE2E2',  // 浅红色背景
  marginTop: 24,
  marginBottom: 40,
},
deactivateBtnText: {
  color: '#EF4444',
  fontSize: 15,
  fontWeight: '600',
},
```

### 3.3 新增 State 和 Handler

```typescript
// Modal 控制
const [showCreateModal, setShowCreateModal] = useState(false);
const [createCode, setCreateCode] = useState('');
const [createName, setCreateName] = useState('');
const [createIcon, setCreateIcon] = useState('');
const [creating, setCreating] = useState(false);

const handleAddChild = () => {
  if (!account) return;
  setCreateCode(`${account.code}-`);
  setCreateName('');
  setCreateIcon('');
  setShowCreateModal(true);
};

const handleCreate = async () => {
  if (!account || !currentBook || !createCode.trim() || !createName.trim()) return;
  setCreating(true);
  try {
    const params: CreateAccountParams = {
      code: createCode.trim(),
      name: createName.trim(),
      type: account.type as CreateAccountParams['type'],
      balance_direction: account.balance_direction,
      parent_id: account.id,
      ...(createIcon.trim() ? { icon: createIcon.trim() } : {}),
    };
    const { data } = await accountService.createAccount(currentBook.id, params);
    setShowCreateModal(false);
    await fetchTree(currentBook.id);

    if (data.migration?.triggered) {
      showToast('分录已迁移', data.migration.message, 5000);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.detail || '创建失败';
    showToast('错误', msg);
  } finally {
    setCreating(false);
  }
};

const handleDeactivate = () => {
  if (!account) return;
  const doDeactivate = async () => {
    try {
      await accountService.deactivateAccount(account.id);
      if (currentBook) await fetchTree(currentBook.id);
      router.back();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '停用失败';
      showToast('错误', msg);
    }
  };

  // 所有平台统一使用 <Modal> 确认（遵循 DESIGN_GUIDELINES 第 2 节）
  setShowDeactivateConfirm(true);
};
```

> 遵循 DESIGN_GUIDELINES 第 2 节：确认弹窗统一使用 `<Modal>` 组件，**不使用** `window.confirm`、`window.alert` 或 `Alert.alert`。

### 3.4 停用确认 Modal

```typescript
const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

const handleDeactivate = () => {
  if (!account) return;
  setShowDeactivateConfirm(true);
};

const confirmDeactivate = async () => {
  if (!account) return;
  try {
    await accountService.deactivateAccount(account.id);
    if (currentBook) await fetchTree(currentBook.id);
    setShowDeactivateConfirm(false);
    router.back();
  } catch (err: any) {
    const msg = err?.response?.data?.detail || '停用失败';
    showToast('错误', msg);
    setShowDeactivateConfirm(false);
  }
};
```

停用确认 Modal：

```typescript
<Modal visible={showDeactivateConfirm} transparent animationType="fade">
  <Pressable style={modalStyles.overlay} onPress={() => setShowDeactivateConfirm(false)}>
    <View style={[modalStyles.content, { backgroundColor: colors.card }]}>
      <Text style={[modalStyles.title, { color: colors.text }]}>停用科目</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
        确定要停用「{account?.name}」吗？
      </Text>
      <View style={modalStyles.btnRow}>
        <Pressable
          style={[modalStyles.btn, { backgroundColor: colors.border }]}
          onPress={() => setShowDeactivateConfirm(false)}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
        </Pressable>
        <Pressable
          style={[modalStyles.btn, { backgroundColor: '#EF4444' }]}
          onPress={confirmDeactivate}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>停用</Text>
        </Pressable>
      </View>
    </View>
  </Pressable>
</Modal>
```

### 3.5 新增子科目 Modal

复用与 `accounts/index.tsx` 相同的 Modal 结构，但固定为子科目模式（无方向选择器）。为避免重复代码，建议提取 `CreateAccountModal` 共享组件（见第 6 节）。

### 3.6 新增 import

```typescript
import { Modal } from 'react-native';
import type { CreateAccountParams } from '@/services/accountService';
```

---

## 4. 桌面端科目列表 `AccountsPane.tsx`

### 4.1 AccountRow 组件改造

与移动端 `accounts/index.tsx` 的 `AccountRow` 改造完全一致：

1. 移除 `onDeactivate` prop，新增 `onAdd` prop
2. 移除 trash-o 按钮，替换为 "+" 按钮
3. 递归传递 `onAdd`

```typescript
// 改造后 Props（第 31-40 行）
function AccountRow({
  node,
  depth,
  onPress,
  onAdd,       // ← 替换 onDeactivate
}: {
  node: AccountTreeNode;
  depth: number;
  onPress: (node: AccountTreeNode) => void;
  onAdd: (node: AccountTreeNode) => void;
}) {
```

### 4.2 标题栏 "+" 按钮

在「科目管理」标题右侧添加：

```typescript
// 当前（第 445-447 行）：
<View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent' }]}>
  <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>科目管理</Text>
</View>

// 改造后：
<View style={[styles.detailContent, { paddingBottom: 10, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
  <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>科目管理</Text>
  <Pressable
    onPress={handleHeaderAdd}
    style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
  >
    <FontAwesome name="plus" size={18} color={Colors.primary} />
  </Pressable>
</View>
```

### 4.3 移除停用 Modal

移除 `AccountsPane` 中的：
- `deleteTarget` state（第 384 行）
- `handleDeactivate` 函数（第 406-408 行）
- `confirmDeactivate` 函数（第 410-422 行）
- 停用确认 `<Modal>` 组件（第 511-528 行）

停用功能已移至 `AccountDetailInline`。

### 4.4 新增 State 和 Handler

```typescript
// 与移动端相同的 state
const [showCreateModal, setShowCreateModal] = useState(false);
const [createParent, setCreateParent] = useState<AccountTreeNode | null>(null);
const [createCode, setCreateCode] = useState('');
const [createName, setCreateName] = useState('');
const [createDirection, setCreateDirection] = useState<'debit' | 'credit'>('debit');
const [createIcon, setCreateIcon] = useState('');
const [creating, setCreating] = useState(false);

const handleAdd = (node: AccountTreeNode) => { /* 同移动端 */ };
const handleHeaderAdd = () => { /* 同移动端 */ };
const handleCreate = async () => {
  // 与移动端相同，但错误/迁移提示使用 showToast
  // ...
  if (data.migration?.triggered) {
    showToast(data.migration.message);
  }
  // ...catch:
  showToast(msg);
};
```

### 4.5 提示反馈（统一 Toast）

遵循 `DESIGN_GUIDELINES.md` 第 1 节，移动端和桌面端统一使用 `showToast`：

| 场景 | 实现 |
|------|------|
| 创建成功 + 迁移 | `showToast('分录已迁移', msg, 5000)` |
| 创建失败 | `showToast('错误', msg)` |

`showToast` 的 `duration` 参数支持自定义超时。迁移提示内容较长，设为 **5 秒**：

```typescript
const showToast = (title: string, message: string, duration = 3000) => {
  setToastMsg(`${title}: ${message}`);
  setTimeout(() => setToastMsg(''), duration);
};

// 迁移提示调用：
showToast('分录已迁移', data.migration.message, 5000);
```

> **注意**：移动端也使用同一套 `showToast` + Toast 组件，不再使用 `Alert.alert`，保持全平台体验一致。

---

## 5. 桌面端科目详情 `AccountDetailInline`

### 5.1 子科目 Section "+" 按钮

改造思路与移动端 `accounts/[id].tsx` 一致：

1. 子科目 section 始终显示（移除 `account.children.length > 0` 条件判断）
2. 标题右侧添加 "+" 按钮
3. 无子科目时显示引导提示

```typescript
// 替换第 345-365 行
{/* 子科目 section — 始终显示 */}
<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
    {account.children.length > 0
      ? `子科目（${account.children.length}）`
      : '新增子科目'}
  </Text>
  <Pressable
    style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
    onPress={handleAddChild}
  >
    <FontAwesome name="plus" size={13} color={Colors.primary} />
  </Pressable>
</View>
<View style={[styles.formCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
  {account.children.length > 0 ? (
    account.children.map((child) => (
      <Pressable
        key={child.id}
        style={[styles.acctRow, { paddingLeft: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' }]}
        onPress={() => setChildDetailId(child.id)}
      >
        <FontAwesome name={(child.icon as any) || 'circle-o'} size={14} color={Colors.primary} style={{ width: 24 }} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', marginLeft: 8 }}>{child.name}</Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginRight: 4 }}>{child.code}</Text>
        <FontAwesome name="chevron-right" size={10} color={colors.textSecondary} style={{ opacity: 0.4 }} />
      </Pressable>
    ))
  ) : (
    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
        点击右侧 ＋ 添加子科目
      </Text>
    </View>
  )}
</View>
```

### 5.2 停用科目按钮（底部）

在子科目 section 之后添加：

```typescript
{!account.is_system && (
  <Pressable
    style={{
      height: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FEE2E2',
      marginTop: 24,
      marginBottom: 40,
    }}
    onPress={() => setShowDeactivateConfirm(true)}
  >
    <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '600' }}>停用科目</Text>
  </Pressable>
)}
```

### 5.3 新增 State 和 Handler

```typescript
// 新增子科目
const [showCreateModal, setShowCreateModal] = useState(false);
const [createCode, setCreateCode] = useState('');
const [createName, setCreateName] = useState('');
const [createIcon, setCreateIcon] = useState('');
const [creating, setCreating] = useState(false);

// 停用确认
const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

const handleAddChild = () => {
  if (!account) return;
  setCreateCode(`${account.code}-`);
  setCreateName('');
  setCreateIcon('');
  setShowCreateModal(true);
};

const handleCreateChild = async () => {
  if (!account || !currentBook || !createCode.trim() || !createName.trim()) return;
  setCreating(true);
  try {
    const params: CreateAccountParams = {
      code: createCode.trim(),
      name: createName.trim(),
      type: account.type as CreateAccountParams['type'],
      balance_direction: account.balance_direction,
      parent_id: account.id,
      ...(createIcon.trim() ? { icon: createIcon.trim() } : {}),
    };
    const { data } = await accountService.createAccount(currentBook.id, params);
    setShowCreateModal(false);
    await fetchTree(currentBook.id);
    if (data.migration?.triggered) {
      showToast(data.migration.message, 5000);
    }
  } catch (err: any) {
    showToast(err?.response?.data?.detail || '创建失败');
  } finally {
    setCreating(false);
  }
};

const handleConfirmDeactivate = async () => {
  if (!account) return;
  try {
    await accountService.deactivateAccount(account.id);
    if (currentBook) await fetchTree(currentBook.id);
    setShowDeactivateConfirm(false);
    onBack();  // 返回列表
  } catch (err: any) {
    showToast(err?.response?.data?.detail || '停用失败');
    setShowDeactivateConfirm(false);
  }
};
```

### 5.4 新增 Modal（停用确认 + 新增子科目）

在 `AccountDetailInline` 返回的 JSX 最外层 `<View>` 内添加两个 Modal：

1. **新增子科目 Modal** — 固定子科目模式，UI 同第 2 节的 Modal 但仅含子科目字段
2. **停用确认 Modal** — 与当前 `AccountsPane` 中的停用 Modal 结构一致

```typescript
{/* 新增子科目 Modal */}
<Modal visible={showCreateModal} transparent animationType="fade">
  {/* ... 同 accounts/index.tsx 的子科目模式 Modal ... */}
</Modal>

{/* 停用确认 Modal */}
<Modal visible={showDeactivateConfirm} transparent animationType="fade">
  <Pressable style={budgetStyles.overlay} onPress={() => setShowDeactivateConfirm(false)}>
    <View style={[budgetStyles.content, { backgroundColor: colors.card }]}>
      <Text style={[budgetStyles.title, { color: colors.text }]}>停用科目</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
        确定要停用「{account?.name}」吗？
      </Text>
      <View style={budgetStyles.btns}>
        <Pressable
          style={[budgetStyles.btn, { backgroundColor: colors.border }]}
          onPress={() => setShowDeactivateConfirm(false)}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
        </Pressable>
        <Pressable
          style={[budgetStyles.btn, { backgroundColor: '#EF4444' }]}
          onPress={handleConfirmDeactivate}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>停用</Text>
        </Pressable>
      </View>
    </View>
  </Pressable>
</Modal>
```

### 5.5 新增 import

`AccountDetailInline` 当前已在 `AccountsPane.tsx` 文件中，已有 `Modal`、`TextInput` 等 import。需确认 `CreateAccountParams` 类型已引入：

```typescript
import { accountService, type AccountTreeNode, type CreateAccountParams } from '@/services/accountService';
```

---

## 6. 可选优化：提取共享组件 `CreateAccountModal`

三个入口（列表页行内 "+"、列表页 Header "+"、详情页子科目 "+"）使用相同的 Modal 表单逻辑。可提取为共享组件：

```typescript
// client/features/account/CreateAccountModal.tsx
type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (data: AccountCreateResponse) => void;
  bookId: string;
  /** 子科目模式：传入父科目节点 */
  parent?: AccountTreeNode | null;
  /** 顶级模式：传入当前 Tab 类型 */
  accountType?: AccountType;
};

export function CreateAccountModal({ visible, onClose, onCreated, bookId, parent, accountType }: Props) {
  const isChildMode = !!parent;
  // ... 表单 state 和 handler ...
  // ... Modal UI ...
}
```

使用方：

```typescript
// accounts/index.tsx
<CreateAccountModal
  visible={showCreateModal}
  onClose={() => setShowCreateModal(false)}
  onCreated={handleCreated}
  bookId={currentBook.id}
  parent={createParent}
  accountType={activeTab}
/>

// accounts/[id].tsx + AccountDetailInline
<CreateAccountModal
  visible={showCreateModal}
  onClose={() => setShowCreateModal(false)}
  onCreated={handleCreated}
  bookId={currentBook.id}
  parent={account}
/>
```

**是否提取取决于实施节奏**。如果三个文件一次性完成，先在 `accounts/index.tsx` 写完 Modal 后直接复制到其他两处也可以。

---

## 7. 数据流概览

### 7.1 行内 "+" 创建子科目

```
用户点击科目行 [＋]
  ↓ onAdd(node) 回调
setState: createParent = node, createCode = "{node.code}-", showCreateModal = true
  ↓ 用户填写编码后缀 + 名称
点击「创建」
  ↓ handleCreate()
accountService.createAccount(bookId, {
  code, name, type: parent.type,
  balance_direction: parent.balance_direction,
  parent_id: parent.id, icon
})
  ↓ 后端处理
POST /books/{book_id}/accounts → 201
  ↓ 响应
{ id, code, name, ..., migration: { triggered, fallback_account, migrated_lines_count, message } }
  ↓ 前端处理
1. setShowCreateModal(false)
2. fetchTree(bookId) — 刷新科目树
3. if (migration.triggered) → Alert/Toast 展示迁移信息
```

### 7.2 Header "+" 创建顶级科目

```
用户点击 Header [＋]
  ↓ handleHeaderAdd()
setState: createParent = null, createCode = "", createDirection = DEFAULT[activeTab], showCreateModal = true
  ↓ 用户填写编码 + 名称（+ 可选调整方向）
点击「创建」
  ↓ handleCreate()
accountService.createAccount(bookId, {
  code, name, type: activeTab,
  balance_direction: createDirection, icon
})
  ↓ (无 parent_id → 不会触发迁移)
fetchTree(bookId)
```

### 7.3 停用科目

```
用户在详情页底部点击「停用科目」
  ↓ handleDeactivate()
setShowDeactivateConfirm(true) — 弹出 <Modal> 确认弹窗
  ↓ 用户确认
accountService.deactivateAccount(accountId)
  ↓ DELETE /accounts/{account_id}
成功 → fetchTree + 返回上一页/列表
失败 → showToast 展示后端错误（如"有分录引用"、"有子科目"）
```

---

## 8. 错误处理

### 8.1 后端错误码映射

| HTTP 状态码 | 场景 | 后端 `detail` | 前端展示 |
|------------|------|--------------|---------|
| 400 | 编码重复 | `科目编码 {code} 已存在` | 原样展示 |
| 400 | 类型不匹配 | `子科目类型必须与父科目一致` | 原样展示 |
| 400 | 停用有分录科目 | `科目「{name}」（{code}）下有 N 条分录引用...` | 原样展示 |
| 400 | 停用有子科目 | `科目「{name}」（{code}）下有 N 个子科目...` | 原样展示 |
| 403 | 无权限 | `无权访问该账本` | 原样展示 |
| 网络错误 | 请求超时/断网 | 无 | `创建失败` / `停用失败` |

### 8.2 前端校验

| 校验项 | 实现 |
|--------|------|
| 编码为空 | 创建按钮 `disabled={!createCode.trim() \|\| !createName.trim()}` |
| 名称为空 | 同上 |
| 重复提交 | `disabled={creating}` + `setCreating(true)` 在请求前 |

---

## 9. 测试计划

### 9.1 手动测试场景

| 编号 | 场景 | 步骤 | 预期结果 |
|------|------|------|---------|
| T-1 | 行内 "+" 创建子科目 | 点击「餐饮饮食」行 "+" → 填写编码 5001-01、名称「外卖」→ 创建 | 「外卖」出现在「餐饮饮食」下方 |
| T-2 | Header "+" 创建顶级科目 | 切到「费用」Tab → 点击 Header "+" → 填写编码 5099、名称「测试科目」→ 创建 | 新科目出现在费用 Tab 列表末尾 |
| T-3 | 编码预填 | 点击 "1001" 行的 "+" | Modal 编码字段预填 `1001-` |
| T-4 | 类型/方向锁定 | 点击 expense 科目行 "+" | Modal 显示类型「费用」、方向「借方」，均为只读 |
| T-5 | 顶级模式方向可选 | 在 expense Tab 点击 Header "+" | 方向默认「借方」，可切换为「贷方」 |
| T-6 | 编码重复 | 创建编码 `1001` 的科目（已存在） | 展示后端错误信息 |
| T-7 | 创建按钮禁用 | 编码或名称为空时 | 创建按钮灰色不可点击 |
| T-8 | 迁移触发 | 给有分录的叶子科目首次创建子科目 | 创建成功 + 展示迁移提示 |
| T-9 | 无迁移 | 给无分录的科目创建子科目 | 创建成功，无迁移提示 |
| T-10 | 详情页 "+" | 进入科目详情页 → 点击子科目 section "+" | 弹出子科目模式 Modal |
| T-11 | 无子科目引导 | 进入无子科目的科目详情页 | 显示「新增子科目」section + 引导文案 |
| T-12 | 停用按钮在详情页 | 进入非系统科目详情页 | 页面底部有红色「停用科目」按钮 |
| T-13 | 系统科目无停用按钮 | 进入系统科目详情页 | 无停用按钮 |
| T-14 | 停用有分录科目 | 点击停用一个有分录的科目 | 确认后展示后端错误 |
| T-15 | 科目列表无停用按钮 | 查看科目列表 | 行内只有 "+"，无 trash-o |
| T-16 | 桌面端一致性 | 在桌面端执行 T-1 ~ T-15 | 行为与移动端一致 |

---

## 10. 开发实施计划

### 阶段 1：移动端科目列表页（预计 0.5 天）

1. 改造 `AccountRow` 组件：移除 `onDeactivate` + trash-o，新增 `onAdd` + "+" 按钮
2. 添加 Header "+" 按钮
3. 实现新增科目 Modal（子科目模式 + 顶级模式）
4. 实现 `handleCreate` 含迁移提示
5. 移除 `handleDeactivate`

### 阶段 2：移动端科目详情页（预计 0.5 天）

1. 子科目 section 始终显示 + "+" 按钮
2. 无子科目引导提示
3. 新增子科目 Modal
4. 页面底部停用按钮 + 确认 Modal
5. `handleDeactivate` → `confirmDeactivate` → `router.back()`

### 阶段 3：桌面端科目列表（预计 0.3 天）

1. `AccountRow` 同步改造
2. 标题栏 "+" 按钮
3. 移除停用 Modal 和相关 state
4. 新增科目 Modal（使用 `showToast` 替代 `Alert.alert`）

### 阶段 4：桌面端科目详情（预计 0.3 天）

1. `AccountDetailInline` 子科目 section "+" 按钮
2. 底部停用按钮 + 确认 Modal
3. 新增子科目 Modal

### 阶段 5：测试 & 验证（预计 0.4 天）

1. 移动端全场景测试（T-1 ~ T-15）
2. 桌面端全场景测试（T-16）
3. Web 端确认弹窗测试（确保不使用 `window.confirm`）
4. 迁移场景端到端测试

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 移动端科目列表页 | 0.5 天 | 0.5 天 |
| 2 | 移动端科目详情页 | 0.5 天 | 1 天 |
| 3 | 桌面端科目列表 | 0.3 天 | 1.3 天 |
| 4 | 桌面端科目详情 | 0.3 天 | 1.6 天 |
| 5 | 测试 & 验证 | 0.4 天 | 2 天 |

> v0.2.3 总计约 **2 个工作日**。

---

## 11. 注意事项

### 11.1 DESIGN_GUIDELINES 遵循

| 规范 | 本版本应用 |
|------|-----------|
| 第 1 节 — 提示反馈 | 全平台统一使用 `showToast`，**不使用** `window.alert` 或 `Alert.alert` |
| 第 2 节 — 确认弹窗 | 停用确认全平台统一使用 `<Modal>`，**不使用** `window.confirm` 或 `Alert.alert` |
| 第 3 节 — 面板内导航 | 桌面端所有交互在 `AccountsPane` / `AccountDetailInline` 内完成，不使用 `router.push` |
| 第 10 节 — Modal 尺寸 | `width: '85%'`, `maxWidth: 420`, `borderRadius: 14`, `padding: 24` |

### 11.2 已知边界情况

| 场景 | 处理 |
|------|------|
| 科目树为空（新账本） | Header "+" 按钮始终可见，用户可创建首个科目 |
| 深层嵌套科目 | 行内 "+" 在任意深度的科目行都可用，不限制层级 |
| 快速连续点击 "+" | `creating` state 防止重复提交 |
| 创建后科目树不刷新 | `handleCreate` 中 `await fetchTree(bookId)` 确保刷新 |
| 桌面端从列表进详情再停用 | `onBack()` 回到列表，列表因 `fetchTree` 已更新 |
