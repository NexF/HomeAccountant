# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.8**
> **创建日期：2026-03-03**
> **基于版本：v0.4.7（对账机制优化）**
> **状态：规划中**
> **本版本变更：新增隐私模式（一键隐藏全局金额）；统一前端金额格式化函数**

---

## 1. 技术架构概述

v0.4.8 是一次**纯前端变更**，不涉及后端 API、数据库或插件改动。核心工作分两步：

1. **Step 1 — 格式化函数统一**：新建 `utils/format.ts`，收拢散落在 20+ 文件中的金额格式化逻辑
2. **Step 2 — 隐私模式**：新建 `stores/privacyStore.ts` + `components/PrivacyToggle.tsx`，格式化函数读取 store 状态返回遮罩文本

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：无变更

### 1.1 变更范围总览

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Utils** | `client/utils/format.ts` | 新增 | 统一金额格式化函数（含隐私遮罩） |
| **Store** | `client/stores/privacyStore.ts` | 新增 | 隐私模式状态管理 + AsyncStorage 持久化 |
| **组件** | `client/components/PrivacyToggle.tsx` | 新增 | 眼睛图标按钮组件 |
| **布局** | `client/app/(tabs)/_layout.tsx` | 修改 | headerRight 接入眼睛图标 |
| **设置** | `client/app/profile/settings.tsx` | 修改 | 新增"隐藏金额"开关行 |
| **设置** | `client/features/profile/SettingsPane.tsx` | 修改 | 同上（桌面端） |
| **格式化重构** | 24 个组件/页面文件 | 修改 | 替换局部函数 + 内联格式化为统一函数调用 |

---

## 2. 新增模块

### 2.1 `client/utils/format.ts` — 统一金额格式化

#### 2.1.1 现状分析

当前项目金额格式化存在 **3 类问题**：

| 问题 | 数量 | 示例 |
|------|------|------|
| 重复命名函数（`formatMoney`/`fmt`/`fmtImpact`/`fmtShort`/`fmtY`） | 8 个文件，6 种函数名 | `BalanceSheetTable.tsx`、`index.tsx`、`EntryCard.tsx` 等 |
| 裸 `toLocaleString()`（无精度参数，小数位不确定） | ~20 处 | `BudgetCard.tsx`、`AssetsPane.tsx`、`LoansPane.tsx` 等 |
| 内联 `toFixed(2)`（无千分位分隔符） | ~40 处 | `RepaymentSchedule.tsx`、`DepreciationChart.tsx`、`ledger.tsx` 等 |

#### 2.1.2 接口设计

```typescript
// client/utils/format.ts

import { usePrivacyStore } from '@/stores/privacyStore';

// ---- 遮罩常量 ----
const MASK_STANDARD = '¥****.**';     // 标准遮罩
const MASK_WITH_SIGN = '¥****.**';    // 带符号遮罩（隐私模式下不区分正负）
const MASK_SHORT = '¥**.**万';        // 短格式遮罩

// ---- 内部格式化（不含遮罩） ----
function _fmt(v: number): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-¥${s}` : `¥${s}`;
}

function _fmtWithSign(v: number): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (v > 0) return `+¥${s}`;
  if (v < 0) return `-¥${s}`;
  return `¥${s}`;
}

function _fmtShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toFixed(0);
}

// ---- 公开 API ----

/**
 * 标准金额：¥1,234.56 / -¥1,234.56
 * 隐私模式：¥****.**
 */
export function formatMoney(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_STANDARD;
  return _fmt(v);
}

/**
 * 带正负号：+¥1,234.56 / -¥1,234.56 / ¥0.00
 * 隐私模式：¥****.**
 */
export function formatMoneyWithSign(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_WITH_SIGN;
  return _fmtWithSign(v);
}

/**
 * 图表 Y 轴短格式：1.2万 / 350
 * 隐私模式：¥**.**万
 */
export function formatMoneyShort(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return MASK_SHORT;
  return _fmtShort(v);
}

/**
 * 纯数字（无 ¥ 前缀）：1,234.56
 * 用于 toFixed(2) 替换场景（如 input 默认值、toast 消息）
 * 隐私模式：****.**
 */
export function formatAmount(v: number): string {
  if (usePrivacyStore.getState().hideAmounts) return '****.**';
  return Math.abs(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
```

#### 2.1.3 设计说明

| 决策 | 理由 |
|------|------|
| 使用 `usePrivacyStore.getState()` 而非 hook | 格式化函数在非 React 上下文（如图表回调）中也会调用，不能依赖 hook；`getState()` 是 zustand 推荐的非组件内读取方式 |
| 调用方组件需 `usePrivacyStore(s => s.hideAmounts)` 触发重渲染 | 格式化函数本身不触发重渲染，需要组件通过 hook 订阅状态变化来重新调用格式化函数 |
| 新增 `formatAmount`（无 ¥ 前缀） | 部分场景（toast 消息、input 默认值）只需要数字部分，如 `已生成调节分录：¥${formatAmount(diff)}` |
| 遮罩文本为固定宽度字符串 | 保证切换时布局不跳动 |

### 2.2 `client/stores/privacyStore.ts` — 隐私模式状态

```typescript
// client/stores/privacyStore.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'privacy_hide_amounts';

type PrivacyState = {
  hideAmounts: boolean;
  /** 是否已从存储加载完毕（防止闪烁） */
  hydrated: boolean;
  toggleHideAmounts: () => void;
  loadPrivacySetting: () => Promise<void>;
};

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  hideAmounts: false,
  hydrated: false,

  toggleHideAmounts: () => {
    const next = !get().hideAmounts;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ hideAmounts: next });
  },

  loadPrivacySetting: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        set({ hideAmounts: JSON.parse(raw), hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },
}));
```

#### 设计说明

| 决策 | 理由 |
|------|------|
| 使用 `AsyncStorage` 而非 `SecureStore` | 隐私模式状态不是敏感凭证，`AsyncStorage` 与 `bookStore` 保持一致即可 |
| `hydrated` 字段 | 防止应用启动时短暂显示明文金额再切换为遮罩（闪烁问题） |
| 不使用 zustand `persist` 中间件 | 项目既有 store 均未使用 persist，保持一致性；手动调用 `loadPrivacySetting` 更可控 |

### 2.3 `client/components/PrivacyToggle.tsx` — 眼睛图标按钮

```typescript
// client/components/PrivacyToggle.tsx

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { usePrivacyStore } from '@/stores/privacyStore';

type Props = {
  color: string;
  size?: number;
};

export function PrivacyToggle({ color, size = 18 }: Props) {
  const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
  const toggle = usePrivacyStore((s) => s.toggleHideAmounts);

  return (
    <Pressable onPress={toggle} style={styles.btn} hitSlop={8}>
      <FontAwesome
        name={hideAmounts ? 'eye-slash' : 'eye'}
        size={size}
        color={color}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

---

## 3. 布局与 UI 入口改动

### 3.1 `client/app/(tabs)/_layout.tsx` — Header 接入眼睛图标

**当前代码**（第 21-31 行）：

```tsx
function HeaderBookSwitcher({ onCreateBook, onOpenSettings }) {
  return (
    <View style={headerStyles.rightContainer}>
      <BookSwitcher onCreateBook={onCreateBook} onOpenSettings={onOpenSettings} compact />
    </View>
  );
}
```

**改动**：在 `BookSwitcher` 左侧插入 `PrivacyToggle`：

```tsx
import { PrivacyToggle } from '@/components/PrivacyToggle';

function HeaderBookSwitcher({ onCreateBook, onOpenSettings }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  return (
    <View style={headerStyles.rightContainer}>
      <PrivacyToggle color={colors.textSecondary} />
      <BookSwitcher onCreateBook={onCreateBook} onOpenSettings={onOpenSettings} compact />
    </View>
  );
}
```

`headerStyles.rightContainer` 样式调整为 `flexDirection: 'row'`，`alignItems: 'center'`，`gap: 8`。

**效果**：4 个 Tab 页（总览/账本/报表/我的）统一生效，无需逐个修改。

### 3.2 子页面 Header

非 Tab 页面（如 `app/entry/[id].tsx`、`app/my-accounts/index.tsx`、`app/accounts/[id].tsx` 等）通过 expo-router 的 `Stack.Screen options` 设置 `headerRight`。

**策略**：创建一个 helper 函数供子页面复用：

```typescript
// utils/headerOptions.ts（或直接在 format.ts 中导出）
import { PrivacyToggle } from '@/components/PrivacyToggle';

export function privacyHeaderRight(color: string) {
  return () => <PrivacyToggle color={color} />;
}
```

子页面使用：

```tsx
<Stack.Screen options={{ headerRight: privacyHeaderRight(colors.textSecondary) }} />
```

需要添加 `headerRight` 的子页面列表：

| 文件 | 页面 |
|------|------|
| `app/entry/[id].tsx` | 分录详情 |
| `app/entry/new.tsx` | 新建分录 |
| `app/accounts/[id].tsx` | 科目详情 |
| `app/my-accounts/index.tsx` | 我的账户 |
| `app/assets/[id].tsx` | 资产详情 |
| `app/assets/new.tsx` | 新建资产 |
| `app/loans/[id].tsx` | 贷款详情 |
| `app/loans/index.tsx` | 贷款列表 |
| `app/loans/new.tsx` | 新建贷款 |
| `app/settings/data-import.tsx` | 数据导入 |
| `app/reports/trends.tsx` | 趋势报表 |
| `app/reports/income-statement.tsx` | 利润表 |

### 3.3 `client/app/profile/settings.tsx` — 新增隐藏金额开关

在"货币显示"行下方、"通知"行上方新增一行：

```tsx
import { Switch } from 'react-native';
import { usePrivacyStore } from '@/stores/privacyStore';

// 组件内：
const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
const toggleHide = usePrivacyStore((s) => s.toggleHideAmounts);

// JSX：
<View style={styles.row}>
  <Text style={[styles.label, { color: colors.textSecondary }]}>隐藏金额</Text>
  <Switch value={hideAmounts} onValueChange={toggleHide} />
</View>
```

### 3.4 `client/features/profile/SettingsPane.tsx` — 同上（桌面端）

逻辑与 `settings.tsx` 相同，在对应位置新增 `Switch` 行。

### 3.5 隐私状态初始化

在应用入口（`app/_layout.tsx`）加载隐私设置：

```tsx
import { usePrivacyStore } from '@/stores/privacyStore';

// 在 RootLayout 的 useEffect 中：
useEffect(() => {
  usePrivacyStore.getState().loadPrivacySetting();
}, []);
```

---

## 4. 格式化函数替换 — 详细清单

### 4.1 Step 1a — 替换命名函数（移除局部定义，改为 import）

| # | 文件 | 当前局部函数 | 行号 | 替换为 |
|---|------|-------------|------|--------|
| 1 | `features/report/BalanceSheetTable.tsx` | `function formatMoney(v)` | 11-18 | 删除；`import { formatMoney } from '@/utils/format'` |
| 2 | `features/report/IncomeStatementTable.tsx` | `function formatMoney(v)` | 8-15 | 同上 |
| 3 | `features/report/NetWorthBadge.tsx` | `function fmt(n)` | 16-20 | 删除；`import { formatMoney } from '@/utils/format'`；调用处 `fmt(` → `formatMoney(` |
| 4 | `app/(tabs)/index.tsx` | `function fmt(n)` | 33-37 | 同上 |
| 5 | `features/profile/MyAccountsPane.tsx` | `const fmt = (val)` | 182-189 | 同上 |
| 6 | `app/my-accounts/index.tsx` | `const fmt = (val)` | 182-189 | 同上 |
| 7 | `features/entry/EntryCard.tsx` | `function fmtImpact(n)` | 23-29 | 删除；`import { formatMoneyWithSign } from '@/utils/format'`；调用处 `fmtImpact(` → `formatMoneyWithSign(` |
| 8 | `features/chart/BarChart.tsx` | `function fmtShort(v)` | 20-24 | 删除；`import { formatMoneyShort } from '@/utils/format'`；调用处 `fmtShort(` → `formatMoneyShort(` |
| 9 | `features/chart/LineChart.tsx` | `function fmtY(v)` | 71-75 | 删除；`import { formatMoneyShort } from '@/utils/format'`；调用处 `fmtY(` → `formatMoneyShort(` |
| 10 | `features/chart/PieChart.tsx` | `function fmt(n)` | 37-41 | 删除；`import { formatMoney } from '@/utils/format'`；调用处 `fmt(` → `formatMoney(` |

> **注意**：`app/(tabs)/index.tsx` 和 `app/reports/trends.tsx`、`app/reports/income-statement.tsx` 中还有同名 `const fmt` 用于**日期格式化**，需重命名为 `fmtDate` 以避免命名冲突。

### 4.2 Step 1b — 替换内联 `toFixed(2)` / 裸 `toLocaleString()`

以下按文件分组列出每一处需要替换的内联格式化，以及替换策略：

#### 4.2.1 `features/budget/BudgetCard.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 41 | `` `¥{budget.amount.toLocaleString()}` `` | `formatMoney(budget.amount)` |
| 49 | `` `¥{budget.used_amount.toLocaleString()}` `` | `formatMoney(budget.used_amount)` |

#### 4.2.2 `features/budget/BudgetOverview.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 56 | `` `¥{overview.total_used.toLocaleString()}` `` | `formatMoney(overview.total_used)` |
| 59 | `` `¥{(overview.total_budget ?? 0).toLocaleString()}` `` | `formatMoney(overview.total_budget ?? 0)` |

#### 4.2.3 `features/asset/AssetCard.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 90 | `` `¥ {asset.original_cost.toLocaleString()}` `` | `formatMoney(asset.original_cost)` |
| 95 | `` `¥ {asset.net_book_value.toLocaleString()}` `` | `formatMoney(asset.net_book_value)` |
| 103 | `` `¥ {asset.period_depreciation.toFixed(2)}` `` | `formatMoney(asset.period_depreciation)` |

#### 4.2.4 `features/asset/AssetsPane.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 173 | `` `¥ ${asset.original_cost.toLocaleString()}` `` | `formatMoney(asset.original_cost)` |
| 190 | `` `¥ ${asset.accumulated_depreciation.toLocaleString()}` `` | `formatMoney(asset.accumulated_depreciation)` |
| 191 | `` `¥ ${asset.net_book_value.toLocaleString()}` `` | `formatMoney(asset.net_book_value)` |
| 192 | `` `¥ ${asset.period_depreciation.toFixed(2)}` `` | `formatMoney(asset.period_depreciation)` |
| 344 | `` `¥{summary.total_original_cost.toLocaleString()}` `` | `formatMoney(summary.total_original_cost)` |
| 345 | `` `¥{summary.total_net_book_value.toLocaleString()}` `` | `formatMoney(summary.total_net_book_value)` |
| 346 | `` `¥{summary.total_accumulated_depreciation.toLocaleString()}` `` | `formatMoney(summary.total_accumulated_depreciation)` |

#### 4.2.5 `features/asset/DepreciationChart.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 55 | `` `¥{record.amount.toFixed(2)}` `` | `formatMoney(record.amount)` |
| 67 | `` `¥{records[...].accumulated.toFixed(2) ?? '0.00'}` `` | `formatMoney(records[...].accumulated ?? 0)` |
| 75 | `` `¥{records[...].net_value.toFixed(2) ?? originalCost.toFixed(2)}` `` | `formatMoney(records[...].net_value ?? originalCost)` |

#### 4.2.6 `features/loan/LoanOverview.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 72 | `` `¥{summary.total_remaining.toLocaleString()}` `` | `formatMoney(summary.total_remaining)` |
| 78 | `` `¥{monthlyTotal.toFixed(2)}` `` | `formatMoney(monthlyTotal)` |
| 95 | `` `¥{summary.total_interest_paid.toLocaleString()}` `` | `formatMoney(summary.total_interest_paid)` |

#### 4.2.7 `features/loan/LoansPane.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 89 | `` `还款成功，剩余本金 ¥${data.remaining_principal.toFixed(2)}` `` | `` `还款成功，剩余本金 ${formatMoney(data.remaining_principal)}` `` |
| 121 | `` `¥ ${loan.principal.toLocaleString()}` `` | `formatMoney(loan.principal)` |
| 122 | `` `¥ ${loan.remaining_principal.toLocaleString()}` `` | `formatMoney(loan.remaining_principal)` |
| 123 | `` `¥ ${loan.monthly_payment.toFixed(2)}` `` | `formatMoney(loan.monthly_payment)` |
| 124 | `` `¥ ${loan.total_interest.toFixed(2)}` `` | `formatMoney(loan.total_interest)` |
| 247 | `` `¥{summary.total_principal.toLocaleString()}` `` | `formatMoney(summary.total_principal)` |
| 248 | `` `¥{summary.total_remaining.toLocaleString()}` `` | `formatMoney(summary.total_remaining)` |
| 249 | `` `¥{summary.total_interest_paid.toLocaleString()}` `` | `formatMoney(summary.total_interest_paid)` |
| 277 | `` `¥{loan.remaining_principal.toLocaleString()}` `` | `formatMoney(loan.remaining_principal)` |

#### 4.2.8 `features/loan/RepaymentSchedule.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 52 | `` `¥{item.payment.toFixed(2)}` `` | `formatMoney(item.payment)` |
| 53 | `` `¥{item.principal.toFixed(2)}` `` | `formatMoney(item.principal)` |
| 54 | `` `¥{item.interest.toFixed(2)}` `` | `formatMoney(item.interest)` |
| 55 | `` `¥{item.remaining.toFixed(2)}` `` | `formatMoney(item.remaining)` |

#### 4.2.9 `features/account/AccountsPane.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 235 | `` `已生成调节分录：¥${Math.abs(data.difference).toFixed(2)}` `` | `` `已生成调节分录：${formatMoney(Math.abs(data.difference))}` `` |

#### 4.2.10 `features/import/ImportPreview.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 211 | `` `¥{Number(data.summary.expense_total).toFixed(2)}` `` | `formatMoney(Number(data.summary.expense_total))` |
| 215 | `` `¥{Number(data.summary.income_total).toFixed(2)}` `` | `formatMoney(Number(data.summary.income_total))` |
| 220 | `` `¥{Number(data.summary.neutral_total).toFixed(2)}` `` | `formatMoney(Number(data.summary.neutral_total))` |
| 287 | `` `¥{Number(row.amount).toFixed(2)}` `` | `formatMoney(Number(row.amount))` |

#### 4.2.11 `app/(tabs)/ledger.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 267 | `Number(line.debit_amount).toFixed(2)` | `formatAmount(Number(line.debit_amount))` |
| 270 | `Number(line.credit_amount).toFixed(2)` | `formatAmount(Number(line.credit_amount))` |

> 此处使用 `formatAmount`（无 ¥ 前缀），因为原始代码的 ¥ 在独立的 `<Text>` 中。

#### 4.2.12 `app/entry/[id].tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 254 | `` `¥${Number(line.debit_amount).toLocaleString()}` `` | `formatMoney(Number(line.debit_amount))` |
| 264 | `` `¥${Number(line.credit_amount).toLocaleString()}` `` | `formatMoney(Number(line.credit_amount))` |
| 273 | `` `¥{entry.lines.reduce(...).toLocaleString()}` `` | `formatMoney(entry.lines.reduce(...))` |
| 276 | `` `¥{entry.lines.reduce(...).toLocaleString()}` `` | `formatMoney(entry.lines.reduce(...))` |

#### 4.2.13 `app/accounts/[id].tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 127-128 | `Math.abs(data.difference).toFixed(2)` + `` `已生成调节分录：¥${diffStr}` `` | `` `已生成调节分录：${formatMoney(Math.abs(data.difference))}` `` |

#### 4.2.14 `app/assets/[id].tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 161 | `` `¥ ${asset.original_cost.toLocaleString()}` `` | `formatMoney(asset.original_cost)` |
| 189 | `` `¥ ${asset.accumulated_depreciation.toLocaleString()}` `` | `formatMoney(asset.accumulated_depreciation)` |
| 195 | `` `¥ ${asset.net_book_value.toLocaleString()}` `` | `formatMoney(asset.net_book_value)` |
| 201 | `` `¥ ${asset.period_depreciation.toFixed(2)}` `` | `formatMoney(asset.period_depreciation)` |

#### 4.2.15 `app/assets/new.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 297-300 | `(parseFloat(originalCost) * (1 - ...)).toFixed(2)` | `formatAmount(parseFloat(originalCost) * (1 - ...))` |
| 312 | `(depreciable / (months * 30)).toFixed(2)` | `formatAmount(depreciable / (months * 30))` |
| 314 | `(depreciable / months).toFixed(2)` | `formatAmount(depreciable / months)` |

> 这些是预估值展示，使用 `formatAmount`（无 ¥，因为 ¥ 在独立文本中）。

#### 4.2.16 `app/entry/new.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 141 | `mp.toFixed(2)`, `ti.toFixed(2)`, `(p + ti).toFixed(2)` | `formatAmount(mp)`, `formatAmount(ti)`, `formatAmount(p + ti)` |

> 贷款预估值计算，后续在 JSX 中以 `¥{loanPreview.monthlyPayment}` 形式展示。改为 `formatMoney()` 直接在展示处调用。

#### 4.2.17 `app/settings/data-import.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 253 | `` `¥{Number(uploadResult.summary.expense_total).toFixed(2)}` `` | `formatMoney(Number(uploadResult.summary.expense_total))` |
| 257 | `` `¥{Number(uploadResult.summary.income_total).toFixed(2)}` `` | `formatMoney(Number(uploadResult.summary.income_total))` |
| 262 | `` `¥{Number(uploadResult.summary.neutral_total).toFixed(2)}` `` | `formatMoney(Number(uploadResult.summary.neutral_total))` |
| 313 | `` `¥{Number(row.amount).toFixed(2)}` `` | `formatMoney(Number(row.amount))` |

#### 4.2.18 `app/loans/[id].tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 133 | `` `还款成功，剩余本金 ¥${data.remaining_principal.toFixed(2)}` `` | `` `还款成功，剩余本金 ${formatMoney(data.remaining_principal)}` `` |
| 204 | `` `¥ ${loan.principal.toLocaleString()}` `` | `formatMoney(loan.principal)` |
| 207 | `` `¥ ${loan.remaining_principal.toLocaleString()}` `` | `formatMoney(loan.remaining_principal)` |
| 217 | `` `¥ ${loan.monthly_payment.toFixed(2)}` `` | `formatMoney(loan.monthly_payment)` |
| 220 | `` `¥ ${loan.total_interest.toFixed(2)}` `` | `formatMoney(loan.total_interest)` |

#### 4.2.19 `app/loans/index.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 110 | `` `¥{loan.monthly_payment.toFixed(2)}` `` | `formatMoney(loan.monthly_payment)` |

#### 4.2.20 `app/loans/new.tsx`

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 111-113 | `mp.toFixed(2)`, `ti.toFixed(2)`, `(p + ti).toFixed(2)` | 同 `app/entry/new.tsx` 的贷款预估处理 |

#### 4.2.21 `features/report/BalanceSheetTable.tsx`（额外内联处）

| 行号 | 原始代码 | 替换为 |
|------|---------|--------|
| 157 | `account.balance.toFixed(2)` | 保留（用于 `TextInput` defaultValue，不需要遮罩） |
| 369-370 | `` `已生成调节分录：¥${diffStr}` `` | `` `已生成调节分录：${formatMoney(Math.abs(...))}` `` |

---

## 5. 组件重渲染策略

### 5.1 问题

`formatMoney()` 通过 `usePrivacyStore.getState()` 读取状态，但 `getState()` 不触发组件重渲染。如果用户点击眼睛图标切换隐私模式，已渲染的组件不会自动刷新。

### 5.2 方案

每个展示金额的组件需要通过 hook 订阅隐私状态，触发重渲染：

```tsx
// 在组件顶部添加（仅需一行）：
const _privacyMode = usePrivacyStore((s) => s.hideAmounts);
```

这行代码的作用是：当 `hideAmounts` 变化时触发组件重渲染 → 重新调用 `formatMoney()` → `getState()` 读到新值 → 返回遮罩/明文。

**需要添加此订阅的组件**：即 §4 中所有涉及格式化替换的组件文件（24 个）。

### 5.3 为什么不用 React Context

| 方案 | 优点 | 缺点 |
|------|------|------|
| zustand store + getState() | 非组件上下文可用；与现有架构一致；selector 粒度控制 | 组件需手动订阅 |
| React Context | 子树自动重渲染 | 格式化函数在非 React 上下文（图表回调）中不可用；Context 变化导致整棵子树重渲染，性能差 |

**结论**：使用 zustand，每个组件加一行 `usePrivacyStore(s => s.hideAmounts)` 即可。

---

## 6. 图表组件改动

### 6.1 `features/chart/BarChart.tsx`

**Y 轴标签**（当前 `fmtShort` 第 20 行）：

```diff
- function fmtShort(v: number): string { ... }
+ import { formatMoneyShort } from '@/utils/format';
```

Y 轴 `formatYLabel` 回调改为调用 `formatMoneyShort`。柱体高度不变（数据不遮罩，仅标签遮罩）。

**Tooltip**（如果有）：金额文本同样调用 `formatMoney`。

### 6.2 `features/chart/LineChart.tsx`

**Y 轴标签**（当前 `fmtY` 第 71 行）：

```diff
- function fmtY(v: number): string { ... }
+ import { formatMoneyShort } from '@/utils/format';
```

### 6.3 `features/chart/PieChart.tsx`

**图例金额标签**（当前 `fmt` 第 37 行）：

```diff
- function fmt(n: number): string { ... }
+ import { formatMoney } from '@/utils/format';
```

百分比标签保持不变，不受隐私模式影响。

---

## 7. 完整文件变更清单

### 7.1 新增文件（3 个）

| 文件 | 行数（预估） | 说明 |
|------|-------------|------|
| `client/utils/format.ts` | ~60 | 统一格式化函数 |
| `client/stores/privacyStore.ts` | ~35 | 隐私状态 store |
| `client/components/PrivacyToggle.tsx` | ~30 | 眼睛按钮组件 |

### 7.2 修改文件（27 个）

| # | 文件 | 改动要点 |
|---|------|---------|
| 1 | `app/(tabs)/_layout.tsx` | headerRight 插入 PrivacyToggle |
| 2 | `app/(tabs)/index.tsx` | 删除局部 `fmt`（金额），重命名日期 `fmt` 为 `fmtDate`；import `formatMoney`；订阅隐私状态 |
| 3 | `app/(tabs)/ledger.tsx` | 内联 `toFixed(2)` → `formatAmount`；订阅隐私状态 |
| 4 | `app/entry/[id].tsx` | 内联 `toLocaleString()` → `formatMoney`；订阅隐私状态 |
| 5 | `app/entry/new.tsx` | `toFixed(2)` → `formatAmount`；订阅隐私状态 |
| 6 | `app/accounts/[id].tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 7 | `app/my-accounts/index.tsx` | 删除局部 `fmt`；import `formatMoney`；订阅隐私状态 |
| 8 | `app/assets/[id].tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 9 | `app/assets/new.tsx` | `toFixed(2)` → `formatAmount`；订阅隐私状态 |
| 10 | `app/loans/[id].tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 11 | `app/loans/index.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 12 | `app/loans/new.tsx` | `toFixed(2)` → `formatAmount`；订阅隐私状态 |
| 13 | `app/settings/data-import.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 14 | `app/profile/settings.tsx` | 新增隐藏金额 Switch |
| 15 | `app/reports/trends.tsx` | 重命名日期 `fmt` 为 `fmtDate`（避免与金额 `formatMoney` 冲突） |
| 16 | `app/reports/income-statement.tsx` | 同上 |
| 17 | `app/_layout.tsx` | 调用 `loadPrivacySetting()` |
| 18 | `features/report/BalanceSheetTable.tsx` | 删除局部 `formatMoney`；import；订阅隐私状态 |
| 19 | `features/report/IncomeStatementTable.tsx` | 同上 |
| 20 | `features/report/NetWorthBadge.tsx` | 删除局部 `fmt`；import `formatMoney`；订阅隐私状态 |
| 21 | `features/entry/EntryCard.tsx` | 删除局部 `fmtImpact`；import `formatMoneyWithSign`；订阅隐私状态 |
| 22 | `features/chart/BarChart.tsx` | 删除局部 `fmtShort`；import `formatMoneyShort`；订阅隐私状态 |
| 23 | `features/chart/LineChart.tsx` | 删除局部 `fmtY`；import `formatMoneyShort`；订阅隐私状态 |
| 24 | `features/chart/PieChart.tsx` | 删除局部 `fmt`；import `formatMoney`；订阅隐私状态 |
| 25 | `features/profile/SettingsPane.tsx` | 新增隐藏金额 Switch |
| 26 | `features/profile/MyAccountsPane.tsx` | 删除局部 `fmt`；import `formatMoney`；订阅隐私状态 |
| 27 | `features/budget/BudgetCard.tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 28 | `features/budget/BudgetOverview.tsx` | 同上 |
| 29 | `features/asset/AssetCard.tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 30 | `features/asset/AssetsPane.tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 31 | `features/asset/DepreciationChart.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 32 | `features/loan/LoanOverview.tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 33 | `features/loan/LoansPane.tsx` | 内联 → `formatMoney`；订阅隐私状态 |
| 34 | `features/loan/RepaymentSchedule.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 35 | `features/account/AccountsPane.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |
| 36 | `features/import/ImportPreview.tsx` | `toFixed(2)` → `formatMoney`；订阅隐私状态 |

---

## 8. 实施计划

### 8.1 Step 1 — 格式化统一（预计改动 36 个文件）

| 子步骤 | 内容 |
|--------|------|
| 1a | 创建 `utils/format.ts`（暂不含隐私逻辑，纯格式化） |
| 1b | 替换 10 个命名函数（§4.1） |
| 1c | 替换 ~60 处内联格式化（§4.2） |
| 1d | 验证：全量排查 `toFixed(2)` 和 `¥\$\{` 是否有遗漏 |

**验收**：所有金额显示效果不变，格式统一为 `¥1,234.56`。

### 8.2 Step 2 — 隐私模式（预计新增 3 个文件 + 改动 ~5 个文件）

| 子步骤 | 内容 |
|--------|------|
| 2a | 创建 `stores/privacyStore.ts` |
| 2b | 在 `utils/format.ts` 中添加隐私遮罩逻辑 |
| 2c | 创建 `components/PrivacyToggle.tsx` |
| 2d | 修改 `_layout.tsx`（Tab headerRight + 初始化） |
| 2e | 修改 Settings 页面（开关） |
| 2f | 所有格式化组件添加 `usePrivacyStore(s => s.hideAmounts)` 订阅 |
| 2g | 子页面添加 `headerRight` |

**验收**：参照 PRD §4 验收标准 PM-1 ~ PM-8。

---

## 9. 不遮罩的例外场景

| 场景 | 原因 |
|------|------|
| 分录编辑页的金额 `TextInput` | 用户正在输入金额，遮罩会阻碍操作 |
| 对账弹窗的"外部余额"输入框 | 同上 |
| `BalanceSheetTable` 中对账 `TextInput` 的 `defaultValue` | 显示当前余额供用户核对，遮罩无意义 |

这些场景使用原始 `value.toFixed(2)` 即可，不走 `formatMoney`。

---

## 10. 测试策略

| 测试项 | 方法 |
|--------|------|
| 格式化函数单元测试 | 测试 `formatMoney`/`formatMoneyWithSign`/`formatMoneyShort`/`formatAmount` 在正常和隐私模式下的输出 |
| 状态持久化 | 测试 `loadPrivacySetting` 读取 / `toggleHideAmounts` 写入 AsyncStorage |
| 全局遮罩覆盖 | 手动遍历每个页面（总览/账本/报表/预算/资产/贷款/我的账户/分录详情/科目详情），确认无遗漏 |
| 图表标签遮罩 | 确认柱状图/折线图 Y 轴和饼图图例正确遮罩，形状/颜色不变 |
| 布局稳定性 | 切换前后截图对比，确认无跳动 |
| 输入框不受影响 | 确认金额输入框在隐私模式下仍显示真实值 |
