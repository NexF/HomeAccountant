# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.9**
> **创建日期：2026-03-03**
> **基于版本：v0.4.8（隐私模式 + 统一金额格式化）**
> **状态：规划中**
> **本版本变更：金额着色统一为红正绿负动态配色，支持费用/负债科目反转语义**

---

## 1. 技术架构概述

v0.4.9 是一次**纯前端变更**，不涉及后端 API、数据库或插件改动。核心工作：

1. **Step 1 — 新增 `getAmountColor()` 工具函数**：在已有的 `utils/format.ts` 中扩展颜色能力
2. **Step 2 — 改造 6 个组件**：损益表、资产负债表、总览页、净资产卡片、分录卡片统一使用动态着色

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：无变更

### 1.1 变更范围总览

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Utils** | `client/utils/format.ts` | 修改 | 新增 `getAmountColor(v, invert?)` 函数 |
| **组件** | `client/features/report/IncomeStatementTable.tsx` | 修改 | 账户行、合计行、摘要卡片改用动态着色 |
| **组件** | `client/features/report/BalanceSheetTable.tsx` | 修改 | 账户行、摘要卡片、等式改用动态着色，负债科目 `invert=true` |
| **组件** | `client/features/report/NetWorthBadge.tsx` | 修改 | 总资产/总负债/变动改用动态着色 |
| **组件** | `client/features/entry/EntryCard.tsx` | 修改 | `net_worth_impact` 改用 `getAmountColor()` |
| **页面** | `client/app/(tabs)/index.tsx` | 修改 | 本月收入/费用/结余改用动态着色 |

---

## 2. 新增工具函数

### 2.1 `getAmountColor()` — 接口设计

```typescript
// client/utils/format.ts 新增

import Colors from '@/constants/Colors';

/**
 * 根据金额正负返回语义颜色
 * @param v      金额数值
 * @param invert 是否反转正负语义（用于费用/负债科目）
 * @returns 颜色字符串
 *
 * 默认模式（invert=false）：
 *   v > 0  → Colors.asset     (#EF4444 红色) — 正向：赚钱/资产增值
 *   v < 0  → Colors.liability (#10B981 绿色) — 负向：亏损/减值
 *   v = 0  → Colors.neutral   (#6B7280 灰色) — 无变化
 *
 * 反转模式（invert=true）：
 *   v > 0  → Colors.liability (#10B981 绿色) — 费用正数=花钱/负债正数=欠钱
 *   v < 0  → Colors.asset     (#EF4444 红色) — 费用负数=退款/负债负数=超额还款
 *   v = 0  → Colors.neutral   (#6B7280 灰色)
 */
export function getAmountColor(v: number, invert?: boolean): string {
  if (v === 0) return Colors.neutral;
  if (invert) {
    return v > 0 ? Colors.liability : Colors.asset;
  }
  return v > 0 ? Colors.asset : Colors.liability;
}
```

### 2.2 设计说明

| 决策 | 理由 |
|------|------|
| 放在 `utils/format.ts` | v0.4.8 已将金额格式化统一到此文件，颜色是格式化的自然延伸 |
| 使用 `invert` 参数而非按 `account_type` 判断 | 函数保持纯粹，不依赖业务类型；调用方决定是否反转，更灵活 |
| 引用 `Colors` 常量而非硬编码颜色值 | 与全局色彩体系一致，未来支持主题切换时自动跟随 |
| 不使用 `usePrivacyStore` | 此函数返回颜色而非文本，隐私模式下颜色由调用方决定是否覆盖 |

### 2.3 `invert` 语义总结

| 科目类型 | `invert` | 正数含义 | 正数颜色 | 负数含义 | 负数颜色 |
|----------|----------|---------|---------|---------|---------|
| 收入 | `false` | 赚钱 | 🔴 红色 | 亏损 | 🟢 绿色 |
| 费用 | `true` | 花钱 | 🟢 绿色 | 退款 | 🔴 红色 |
| 资产 | `false` | 有资产 | 🔴 红色 | 负资产 | 🟢 绿色 |
| 负债 | `true` | 欠钱 | 🟢 绿色 | 超额还款 | 🔴 红色 |
| 权益 | `false` | 正权益 | 🔴 红色 | 负权益 | 🟢 绿色 |
| 净资产影响 | `false` | 增值 | 🔴 红色 | 减值 | 🟢 绿色 |

---

## 3. 组件改造详情

### 3.1 `IncomeStatementTable.tsx` — 损益表

#### 3.1.1 新增 import

```diff
 import { formatMoney } from '@/utils/format';
+import { getAmountColor } from '@/utils/format';
 import { usePrivacyStore } from '@/stores/privacyStore';
```

> `getAmountColor` 与 `formatMoney` 在同一文件，合并为一行 import 即可。

#### 3.1.2 `AccountRow` 组件 — 着色逻辑替换

**当前代码**（第 14-21 行）：

```tsx
function AccountRow({ item, colors }: { item: AccountBalanceItem; colors: any }) {
  const balanceColor =
    item.account_type === 'income'
      ? Colors.asset
      : item.account_type === 'expense'
      ? Colors.liability
      : colors.text;
```

**改造后**：

```tsx
function AccountRow({ item, colors }: { item: AccountBalanceItem; colors: any }) {
  const balanceColor = getAmountColor(item.balance, item.account_type === 'expense');
```

**逻辑说明**：
- 收入科目：`invert=false` — 正数红色（赚钱），负数绿色（亏损）
- 费用科目：`invert=true` — 正数绿色（花钱），负数红色（退款）
- 其他科目（理论上不会出现在损益表）：`invert=false`，按正负着色

#### 3.1.3 摘要卡片 — 总收入/总费用

**当前代码**（第 82-91 行）：

```tsx
<Text style={[styles.summaryValue, { color: Colors.asset }]}>
  {formatMoney(data.total_income)}
</Text>
...
<Text style={[styles.summaryValue, { color: Colors.liability }]}>
  {formatMoney(data.total_expense)}
</Text>
```

**改造后**：

```tsx
<Text style={[styles.summaryValue, { color: getAmountColor(data.total_income) }]}>
  {formatMoney(data.total_income)}
</Text>
...
<Text style={[styles.summaryValue, { color: getAmountColor(data.total_expense, true) }]}>
  {formatMoney(data.total_expense)}
</Text>
```

#### 3.1.4 本期损益

**当前代码**（第 96-99 行）：

```tsx
{ color: data.net_income >= 0 ? Colors.asset : Colors.liability }
```

**改造后**：

```tsx
{ color: getAmountColor(data.net_income) }
```

#### 3.1.5 合计行

**当前代码**（第 115、132 行）：

```tsx
<Text style={[styles.totalAmount, { color: Colors.asset }]}>     // 收入合计
<Text style={[styles.totalAmount, { color: Colors.liability }]}>  // 费用合计
```

**改造后**：

```tsx
<Text style={[styles.totalAmount, { color: getAmountColor(data.total_income) }]}>
<Text style={[styles.totalAmount, { color: getAmountColor(data.total_expense, true) }]}>
```

#### 3.1.6 不变更的部分

| 元素 | 原因 |
|------|------|
| `PercentBar` 的 `barColor` | 表达类别归属（收入=红 / 费用=绿），非金额方向 |
| 占比百分比文本 | 中性色 `textSecondary`，无正负语义 |

---

### 3.2 `BalanceSheetTable.tsx` — 资产负债表

#### 3.2.1 新增 import

```diff
-import { formatMoney } from '@/utils/format';
+import { formatMoney, getAmountColor } from '@/utils/format';
```

#### 3.2.2 `AccountTreeRow` — 账户行着色

**当前代码**（第 74-81 行）：

```tsx
const balanceColor =
  item.balance > 0
    ? item.account_type === 'liability'
      ? Colors.liability
      : Colors.asset
    : item.balance < 0
    ? Colors.liability
    : colors.text;
```

**改造后**：

```tsx
const balanceColor = getAmountColor(
  item.balance,
  item.account_type === 'liability'
);
```

**逻辑说明**：
- 资产科目：`invert=false` — 正数红色（有资产），负数绿色（资产为负）
- 负债科目：`invert=true` — 正数绿色（欠钱），负数红色（超额还款）
- 权益科目：`invert=false` — 同资产方向

#### 3.2.3 摘要卡片 — 总资产/总负债/本期损益

**当前代码**（第 449-481 行）：

```tsx
{/* 总资产 */}
<Text style={[styles.summaryValue, { color: Colors.asset }]}>
  {formatMoney(data.total_asset)}
</Text>
{/* 总负债 */}
<Text style={[styles.summaryValue, { color: Colors.liability }]}>
  {formatMoney(data.total_liability)}
</Text>
{/* 本期损益 */}
<Text style={[..., { color: data.net_income >= 0 ? Colors.asset : Colors.liability }]}>
  {formatMoney(data.net_income)}
</Text>
```

**改造后**：

```tsx
{/* 总资产 */}
<Text style={[styles.summaryValue, { color: getAmountColor(data.total_asset) }]}>
  {formatMoney(data.total_asset)}
</Text>
{/* 总负债 */}
<Text style={[styles.summaryValue, { color: getAmountColor(data.total_liability, true) }]}>
  {formatMoney(data.total_liability)}
</Text>
{/* 本期损益 */}
<Text style={[..., { color: getAmountColor(data.net_income) }]}>
  {formatMoney(data.net_income)}
</Text>
```

#### 3.2.4 `SectionCard` — `totalColor` 调用方改造

调用方传入 `totalColor` 的位置（第 377-404 行）：

**当前代码**：

```tsx
{/* 资产 */}
<SectionCard
  ...
  totalColor={Colors.asset}
  ...
/>
{/* 负债 */}
<SectionCard
  ...
  totalColor={Colors.liability}
  ...
/>
```

**改造后**：

```tsx
{/* 资产 */}
<SectionCard
  ...
  totalColor={getAmountColor(data.total_asset)}
  ...
/>
{/* 负债 */}
<SectionCard
  ...
  totalColor={getAmountColor(data.total_liability, true)}
  ...
/>
```

#### 3.2.5 `EquitySectionCard` — 本期损益行

**当前代码**（第 300-303 行）：

```tsx
{ color: data.net_income >= 0 ? Colors.asset : Colors.liability }
```

**改造后**：

```tsx
{ color: getAmountColor(data.net_income) }
```

#### 3.2.6 等式校验行

**当前代码**（第 498-504 行）：

```tsx
<Text style={{ color: Colors.asset }}>{formatMoney(data.total_asset)}</Text>
{' = 负债 '}
<Text style={{ color: Colors.liability }}>{formatMoney(data.total_liability)}</Text>
{' + 净资产 '}
<Text style={{ color: Colors.primary }}>{formatMoney(data.adjusted_equity)}</Text>
```

**改造后**：

```tsx
<Text style={{ color: getAmountColor(data.total_asset) }}>{formatMoney(data.total_asset)}</Text>
{' = 负债 '}
<Text style={{ color: getAmountColor(data.total_liability, true) }}>{formatMoney(data.total_liability)}</Text>
{' + 净资产 '}
<Text style={{ color: Colors.primary }}>{formatMoney(data.adjusted_equity)}</Text>
```

> 净资产保持 `Colors.primary`（靛蓝色），不参与红绿着色。

#### 3.2.7 `ReconcileModalBody` — 对账差异

**当前代码**（第 159 行）：

```tsx
const diffColor = diff > 0 ? Colors.asset : diff < 0 ? Colors.liability : Colors.neutral;
```

**改造后**：

```tsx
const diffColor = getAmountColor(diff);
```

#### 3.2.8 不变更的部分

| 元素 | 原因 |
|------|------|
| `ReconcileModalBody` 的 `TextInput` `defaultValue` | 用户核对用，不需要着色 |
| 对账提交后 toast 消息中的金额 | 使用 `formatMoney(Math.abs(...))` 显示绝对值，无正负语义 |

---

### 3.3 `NetWorthBadge.tsx` — 净资产卡片

#### 3.3.1 新增 import

```diff
-import { formatMoney } from '@/utils/format';
+import { formatMoney, getAmountColor } from '@/utils/format';
```

#### 3.3.2 净资产变动着色

**当前代码**（第 24 行）：

```tsx
const changeColor = change > 0 ? Colors.asset : change < 0 ? Colors.liability : colors.textSecondary;
```

**改造后**：

```tsx
const changeColor = getAmountColor(change);
```

> 注意：`getAmountColor(0)` 返回 `Colors.neutral (#6B7280)`，而当前用的是 `colors.textSecondary`。两者在 light 模式下一致（都是 `#6B7280`），dark 模式下 `textSecondary` 为 `#9CA3AF`，略有差异。为保持一致性，零值时使用 `Colors.neutral` 即可。

#### 3.3.3 总资产/总负债着色

**当前代码**（第 42、47 行）：

```tsx
<Text style={[styles.itemValue, { color: Colors.asset }]}>{formatMoney(totalAsset)}</Text>
...
<Text style={[styles.itemValue, { color: Colors.liability }]}>{formatMoney(totalLiability)}</Text>
```

**改造后**：

```tsx
<Text style={[styles.itemValue, { color: getAmountColor(totalAsset) }]}>{formatMoney(totalAsset)}</Text>
...
<Text style={[styles.itemValue, { color: getAmountColor(totalLiability, true) }]}>{formatMoney(totalLiability)}</Text>
```

#### 3.3.4 不变更的部分

| 元素 | 原因 |
|------|------|
| `changeIcon`（`arrow-up`/`arrow-down`/`minus`） | 图标表达变动方向，独立于颜色逻辑，保持不变 |
| 净资产金额 `netAsset` | 使用 `colors.text`（主文字色），作为核心展示数据不区分颜色 |

---

### 3.4 `EntryCard.tsx` — 分录卡片

#### 3.4.1 新增 import

```diff
-import { formatMoneyWithSign } from '@/utils/format';
+import { formatMoneyWithSign, getAmountColor } from '@/utils/format';
```

#### 3.4.2 净资产影响着色

**当前代码**（第 42 行）：

```tsx
const impactColor = impact > 0 ? Colors.asset : impact < 0 ? Colors.liability : colors.textSecondary;
```

**改造后**：

```tsx
const impactColor = getAmountColor(impact);
```

> 同 NetWorthBadge，零值颜色从 `textSecondary` 变为 `Colors.neutral`。在 light 模式下无差异。

---

### 3.5 `(tabs)/index.tsx` — 总览页

#### 3.5.1 新增 import

```diff
-import { formatMoney } from '@/utils/format';
+import { formatMoney, getAmountColor } from '@/utils/format';
```

#### 3.5.2 本月收入卡片

**当前代码**（第 136-138 行）：

```tsx
<Text style={[styles.cardAmount, { color: Colors.asset }]}>
  {formatMoney(d?.month_income ?? 0)}
</Text>
```

**改造后**：

```tsx
<Text style={[styles.cardAmount, { color: getAmountColor(d?.month_income ?? 0) }]}>
  {formatMoney(d?.month_income ?? 0)}
</Text>
```

#### 3.5.3 本月费用卡片

**当前代码**（第 145-147 行）：

```tsx
<Text style={[styles.cardAmount, { color: Colors.liability }]}>
  {formatMoney(d?.month_expense ?? 0)}
</Text>
```

**改造后**：

```tsx
<Text style={[styles.cardAmount, { color: getAmountColor(d?.month_expense ?? 0, true) }]}>
  {formatMoney(d?.month_expense ?? 0)}
</Text>
```

#### 3.5.4 本月结余

**当前代码**（第 156-159 行）：

```tsx
{ color: (d?.month_net_income ?? 0) >= 0 ? Colors.asset : Colors.liability }
```

**改造后**：

```tsx
{ color: getAmountColor(d?.month_net_income ?? 0) }
```

#### 3.5.5 不变更的部分

| 元素 | 原因 |
|------|------|
| 收入卡片 `arrow-up` 图标颜色 `Colors.asset` | 图标固定表达类别含义（收入=上箭头=红色） |
| 费用卡片 `arrow-down` 图标颜色 `Colors.liability` | 同上（费用=下箭头=绿色） |
| 卡片标签文字 "本月收入"/"本月费用" | 使用 `textSecondary`，无正负语义 |

---

## 4. 完整文件变更清单

### 4.1 修改文件（6 个）

| # | 文件 | 改动量（预估） | 改动要点 |
|---|------|--------------|---------|
| 1 | `client/utils/format.ts` | +15 行 | 新增 `getAmountColor(v, invert?)` 函数 |
| 2 | `client/features/report/IncomeStatementTable.tsx` | ~8 处 | `AccountRow` 着色、摘要卡片、合计行、本期损益 |
| 3 | `client/features/report/BalanceSheetTable.tsx` | ~10 处 | 账户行、摘要卡片、等式行、对账差异、SectionCard totalColor |
| 4 | `client/features/report/NetWorthBadge.tsx` | ~3 处 | 变动着色、总资产、总负债 |
| 5 | `client/features/entry/EntryCard.tsx` | ~1 处 | `impactColor` |
| 6 | `client/app/(tabs)/index.tsx` | ~3 处 | 收入、费用、结余着色 |

### 4.2 不变更文件

| 文件 | 原因 |
|------|------|
| `client/app/entry/[id].tsx` | 借方/贷方有独立语义（借=资产色、贷=负债色），不应改为纯正负判断 |
| `client/features/chart/BarChart.tsx` | 柱体颜色为固定主题色，不表达正负 |
| `client/features/chart/LineChart.tsx` | 折线颜色为固定主题色 |
| `client/features/chart/PieChart.tsx` | 饼图颜色为分类色 |
| 所有后端文件 | 纯前端变更 |

---

## 5. 边界情况处理

### 5.1 零值处理

| 场景 | `getAmountColor` 返回 | 显示效果 |
|------|---------------------|---------|
| 收入科目余额 = 0 | `Colors.neutral` (#6B7280) | 灰色 ¥0.00 |
| 费用科目余额 = 0 | `Colors.neutral` (#6B7280) | 灰色 ¥0.00（`invert` 不影响零值） |
| 总资产 = 0 | `Colors.neutral` | 灰色 |
| 本期损益 = 0 | `Colors.neutral` | 灰色 |

### 5.2 隐私模式兼容

| 场景 | 处理方式 |
|------|---------|
| 隐私模式开启 | `formatMoney()` 返回遮罩文本 `¥****.**`，`getAmountColor()` 仍返回对应颜色 |
| 颜色是否泄露信息 | 隐私模式下颜色仍按正负显示，这是 PRD 明确允许的行为。如需进一步保护，可在组件层覆盖为 `colors.text` |

### 5.3 dark 模式兼容

`getAmountColor()` 使用全局常量 `Colors.asset` / `Colors.liability` / `Colors.neutral`，这些在 dark/light 模式下保持一致（红/绿/灰不随主题变化），与当前行为一致。

---

## 6. 改造前后对比

### 6.1 损益表（投资亏损场景）

**改造前**：
```
收入                              
  工资收入     ¥15,000.00  🔴 红色（按类型固定）
  投资收益    -¥5,000.00   🔴 红色（按类型固定）← ❌ 亏损仍红色
  收入合计     ¥10,000.00  🔴 红色

费用
  餐饮         ¥3,200.00   🟢 绿色（按类型固定）
  退款        -¥200.00     🟢 绿色（按类型固定）← ❌ 退款仍绿色
  费用合计     ¥3,000.00   🟢 绿色
```

**改造后**：
```
收入                              
  工资收入     ¥15,000.00  🔴 红色（正数，赚钱）
  投资收益    -¥5,000.00   🟢 绿色（负数，亏损）← ✅
  收入合计     ¥10,000.00  🔴 红色

费用
  餐饮         ¥3,200.00   🟢 绿色（正数+invert，花钱）
  退款        -¥200.00     🔴 红色（负数+invert，退款）← ✅
  费用合计     ¥3,000.00   🟢 绿色
```

### 6.2 资产负债表

**改造前**：
```
资产
  银行存款     ¥50,000.00  🔴 红色  ← 正确
  应收账款    -¥1,000.00   🟢 绿色  ← 正确

负债
  信用卡       ¥8,000.00   🟢 绿色  ← 正确（欠钱）
  超额还款    -¥500.00     🟢 绿色  ← ❌ 应该是红色（退钱）
```

**改造后**：
```
负债
  信用卡       ¥8,000.00   🟢 绿色（正数+invert，欠钱）
  超额还款    -¥500.00     🔴 红色（负数+invert，退钱）← ✅
```

---

## 7. 实施计划

### 7.1 实施步骤

| 步骤 | 内容 | 预估时间 |
|------|------|---------|
| 1 | 在 `utils/format.ts` 中新增 `getAmountColor()` 函数 | 5 min |
| 2 | 改造 `IncomeStatementTable.tsx`（损益表） | 10 min |
| 3 | 改造 `BalanceSheetTable.tsx`（资产负债表） | 10 min |
| 4 | 改造 `NetWorthBadge.tsx`（净资产卡片） | 5 min |
| 5 | 改造 `EntryCard.tsx`（分录卡片） | 3 min |
| 6 | 改造 `(tabs)/index.tsx`（总览页） | 5 min |
| 7 | 全面验证 | 10 min |

**总计**：约 48 min

### 7.2 实施顺序依赖

```
Step 1: utils/format.ts (getAmountColor)
    ↓
Step 2-6: 可并行改造各组件（均只依赖 Step 1）
    ↓
Step 7: 验证
```

---

## 8. 测试策略

### 8.1 单元测试

| 测试项 | 测试用例 |
|--------|---------|
| `getAmountColor(100)` | 返回 `Colors.asset` (#EF4444) |
| `getAmountColor(-100)` | 返回 `Colors.liability` (#10B981) |
| `getAmountColor(0)` | 返回 `Colors.neutral` (#6B7280) |
| `getAmountColor(100, true)` | 返回 `Colors.liability` (#10B981) |
| `getAmountColor(-100, true)` | 返回 `Colors.asset` (#EF4444) |
| `getAmountColor(0, true)` | 返回 `Colors.neutral` (#6B7280) |

### 8.2 集成验证

| 验收编号 | 页面 | 验证场景 | 预期结果 |
|---------|------|---------|---------|
| AC-1 | 损益表 | 收入科目正数 | 红色 |
| AC-2 | 损益表 | 收入科目负数（投资亏损） | 绿色 |
| AC-3 | 损益表 | 费用科目正数（花钱） | 绿色 |
| AC-4 | 损益表 | 费用科目负数（退款） | 红色 |
| AC-5 | 损益表 | 金额为零 | 灰色 |
| AC-6 | 资产负债表 | 资产正数 | 红色 |
| AC-7 | 资产负债表 | 负债正数（欠钱） | 绿色 |
| AC-8 | 资产负债表 | 负债负数（超额还款） | 红色 |
| AC-9 | 总览页 | 本月收入正数 | 红色 |
| AC-10 | 总览页 | 本月费用正数（花钱） | 绿色 |
| AC-11 | 总览页 | 本月结余正数 | 红色 |
| AC-12 | 总览页 | 本月结余负数 | 绿色 |
| AC-13 | 净资产卡片 | 总负债正数 | 绿色 |
| AC-14 | 分录卡片 | `net_worth_impact` 正数 | 红色 |
| AC-15 | 损益表 | 占比条颜色 | 保持按类型固定着色，不受影响 |
| AC-16 | 全局 | 隐私模式开启 | 遮罩文本正常显示，颜色仍按正负 |
| AC-17 | 分录详情 | 借方/贷方金额颜色 | 保持不变（独立语义） |

### 8.3 回归测试

| 测试范围 | 方法 |
|---------|------|
| dark 模式 | 所有改造页面在 dark 模式下验证颜色正确 |
| 隐私模式交叉 | 开启隐私模式后切换页面，确认遮罩 + 颜色均正确 |
| 数据边界 | 所有金额为 0 的场景确认显示灰色 |

---

## 9. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| 零值颜色微调 | `EntryCard` 和 `NetWorthBadge` 零值颜色从 `textSecondary` (#6B7280 light / #9CA3AF dark) 变为 `Colors.neutral` (#6B7280)，dark 模式下略暗 | 视觉差异极小，可接受；如有反馈再调整 |
| `invert` 参数遗漏 | 费用/负债科目忘传 `invert=true` 会导致颜色反了 | 代码审查时重点关注 `account_type` 判断处 |
| 后端数据语义 | 依赖后端费用金额为正数（表示支出额）的约定 | 当前后端已遵循此约定，无需改动 |
| 改动范围小 | 核心改动 6 个文件，风险可控 | — |
