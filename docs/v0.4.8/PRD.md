# v0.4.8 — 隐私模式：一键隐藏金额

> **版本：v0.4.8**
> **创建日期：2026-03-03**
> **基于版本：v0.4.7（对账机制优化）**
> **状态：规划中**
> **本版本变更：新增隐私模式，支持一键隐藏全局金额显示**

---

## 1. 背景

### 1.1 需求场景

在公共场合（通勤、办公室、与他人共享屏幕）使用记账应用时，用户的资产、收支等敏感金额信息容易被他人无意看到。银行/证券类 App（如招商银行、支付宝、富途牛牛）普遍提供"隐藏金额"功能，用户可一键将所有金额替换为遮罩字符。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 一键切换 | 用户在任何页面都能快速开启/关闭隐私模式 |
| 全局生效 | 切换后所有页面的金额同步隐藏/显示，无遗漏 |
| 状态持久化 | 应用重启后保持上次的隐私模式状态 |
| 零后端改动 | 纯前端功能，不涉及 API 或数据库变更 |

## 2. 方案设计

### 2.1 核心交互

#### 2.1.1 隐私模式开关入口

**主入口 — 每个页面标题栏眼睛图标**：

每个页面（Tab 页及子页面）的 Header 右侧均显示眼睛图标，用户在任何页面都能直接切换隐私模式。

仪表盘示例：

```
┌─────────────────────────────────────┐
│  总览           👁  📖个人账本      │  ← 眼睛图标（账本切换器左边）
│                                     │
│  净资产                              │
│  ¥1,241,479.98  ↑¥3,200.00         │
│                                     │
│  总资产           总负债              │
│  ¥1,241,479.98   ¥0.00              │
└─────────────────────────────────────┘
```

点击后切换为隐私模式：

```
┌─────────────────────────────────────┐
│  总览           🙈  📖个人账本      │  ← 图标变为"闭眼"状态
│                                     │
│  净资产                              │
│  ¥****.**        ¥****.**           │
│                                     │
│  总资产           总负债              │
│  ¥****.**        ¥****.**           │
└─────────────────────────────────────┘
```

**辅助入口 — 设置页开关**：

```
┌──────────────────────────────────────┐
│  设置                                │
│                                      │
│  深色模式          跟随系统           │
│  货币显示          ¥ CNY             │
│  隐藏金额          [  ○ ] ← 开关     │  ← 新增
│  通知             即将推出            │
│  版本             0.4.8              │
└──────────────────────────────────────┘
```

#### 2.1.2 遮罩规则

| 场景 | 原始显示 | 隐私模式显示 |
|------|---------|-------------|
| 标准金额 | `¥1,241,479.98` | `¥****.**` |
| 负数金额 | `-¥3,200.00` | `¥****.**` |
| 带正号金额 | `+¥3,200.00` | `¥****.**` |
| 零值 | `¥0.00` | `¥****.**` |
| 简短金额（图表轴） | `¥124.8万` | `¥**.**万` |
| 百分比 | `45.2%` | 正常显示，不遮罩 |
| 数量/笔数 | `3 笔` | 正常显示，不遮罩 |

> 遮罩**只影响金额数值部分**，**保留货币符号 `¥`**，百分比和非金额数字正常展示。

#### 2.1.3 状态持久化

- 使用 `AsyncStorage`（或 `expo-secure-store`）持久化隐私模式状态
- 应用启动时读取上次状态并恢复
- 默认关闭（首次使用时金额正常显示）

### 2.2 技术方案

#### 2.2.1 统一金额格式化函数

当前项目中金额格式化逻辑**高度分散**，同一逻辑在 6+ 个文件中重复定义为局部函数（`formatMoney`、`fmt`、`fmtImpact`），还有更多文件使用内联 `toFixed(2)` / `toLocaleString()`。

**本版本需要先统一**：新建全局工具函数 `utils/format.ts`，提供统一的金额格式化 API，所有组件改为调用全局函数。

```typescript
// utils/format.ts

/** 标准金额：¥1,234.56 / -¥1,234.56 */
function formatMoney(v: number): string;

/** 带正负号：+¥1,234.56 / -¥1,234.56 / ¥0.00 */
function formatMoneyWithSign(v: number): string;

/** 简短金额（图表用）：1.2万 / 350 */
function formatMoneyShort(v: number): string;
```

隐私模式开启时，这些函数统一返回遮罩文本（如 `¥****.**`），无需修改各组件。

#### 2.2.2 状态管理

使用 zustand store（项目已使用 zustand）管理隐私模式状态：

```typescript
// stores/privacyStore.ts
interface PrivacyState {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
  loadPrivacySetting: () => Promise<void>;
}
```

#### 2.2.3 图表处理

| 图表类型 | 隐私模式处理 |
|---------|-------------|
| 柱状图（BarChart） | Y 轴标签遮罩为 `¥**.**万`，柱体高度保留（不泄露具体值但保留趋势） |
| 折线图（LineChart） | Y 轴标签遮罩为 `¥**.**万`，线条保留 |
| 饼图（PieChart） | 金额标签遮罩为 `¥****.**`，百分比正常显示，扇区保留 |

> 图表的**形状/趋势**保留，只遮罩数值标签。这样既保护隐私，又保持页面布局不跳动。

## 3. 涉及文件变更

### 3.1 新增文件

| 文件 | 说明 |
|------|------|
| `client/utils/format.ts` | 统一金额格式化函数（含隐私模式遮罩逻辑） |
| `client/stores/privacyStore.ts` | 隐私模式 zustand store |
| `client/components/HeaderRight.tsx` | 封装眼睛图标按钮，供所有页面 Header 复用 |

### 3.2 修改文件 — 替换分散的格式化函数

以下文件需要移除局部 `formatMoney` / `fmt` / `fmtImpact` 定义，改为从 `utils/format.ts` 导入：

| 文件 | 当前函数 | 替换为 |
|------|---------|--------|
| `features/report/BalanceSheetTable.tsx` | 局部 `formatMoney` | `import { formatMoney } from '@/utils/format'` |
| `features/report/IncomeStatementTable.tsx` | 局部 `formatMoney` | 同上 |
| `features/report/NetWorthBadge.tsx` | 局部 `fmt` | 同上 |
| `app/(tabs)/index.tsx` | 局部 `fmt` | 同上 |
| `features/profile/MyAccountsPane.tsx` | 局部 `fmt` | 同上 |
| `app/my-accounts/index.tsx` | 局部 `fmt` | 同上 |
| `features/entry/EntryCard.tsx` | 局部 `fmtImpact` | `import { formatMoneyWithSign } from '@/utils/format'` |
| `features/chart/BarChart.tsx` | 局部 `fmtShort` | `import { formatMoneyShort } from '@/utils/format'` |

### 3.3 修改文件 — 替换内联金额格式化

以下文件使用内联 `¥${...toLocaleString()}` / `¥${...toFixed(2)}`，需改为调用统一函数：

| 文件 | 说明 |
|------|------|
| `features/budget/BudgetCard.tsx` | 预算额度/已用 |
| `features/budget/BudgetOverview.tsx` | 预算汇总 |
| `features/asset/AssetCard.tsx` | 资产原值/净值/折旧 |
| `features/asset/AssetsPane.tsx` | 资产列表 |
| `features/asset/DepreciationChart.tsx` | 折旧图表 |
| `features/loan/LoanOverview.tsx` | 贷款概览 |
| `features/loan/LoansPane.tsx` | 贷款管理 |
| `features/loan/RepaymentSchedule.tsx` | 还款计划 |
| `features/account/AccountsPane.tsx` | 科目管理（对账金额） |
| `features/chart/LineChart.tsx` | 折线图 Y 轴 |
| `features/chart/PieChart.tsx` | 饼图标签 |
| `features/import/ImportPreview.tsx` | 导入预览 |
| `app/(tabs)/ledger.tsx` | 分录列表 |
| `app/entry/[id].tsx` | 分录详情 |

### 3.4 修改文件 — UI 入口

| 文件 | 变更 |
|------|------|
| `components/HeaderRight.tsx`（新增） | 封装眼睛图标按钮组件，供所有页面 Header 复用 |
| `app/(tabs)/_layout.tsx` | 所有 Tab 页的 `headerRight` 统一接入 `HeaderRight` 组件 |
| `app/(tabs)/index.tsx` | Header 右侧显示眼睛图标（通过 layout 统一配置） |
| `app/(tabs)/ledger.tsx` | 同上 |
| `app/(tabs)/report.tsx` | 同上 |
| `app/(tabs)/profile.tsx` | 同上 |
| 其他子页面（如 `app/entry/[id].tsx`、`app/my-accounts/index.tsx` 等） | `headerRight` 接入眼睛图标 |
| `app/profile/settings.tsx` | 新增"隐藏金额"开关行 |
| `features/profile/SettingsPane.tsx` | 同上（桌面端） |

## 4. 验收标准

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| PM-1 | 眼睛按钮 | **每个页面** Header 右侧均显示眼睛图标，点击可切换开/关 |
| PM-2 | 全局遮罩 | 开启后，所有页面（总览/账本/报表/预算/资产/贷款/我的账户）的金额显示为 `¥****.**` |
| PM-3 | 设置联动 | 设置页"隐藏金额"开关与眼睛按钮状态同步 |
| PM-4 | 持久化 | 开启隐私模式后关闭 App 再打开，仍为隐私模式 |
| PM-5 | 图表处理 | 图表形状/趋势保留，仅数值标签遮罩 |
| PM-6 | 非金额不受影响 | 百分比、笔数、日期等非金额内容正常显示 |
| PM-7 | 布局稳定 | 切换隐私模式时页面布局不跳动（遮罩文本宽度稳定） |
| PM-8 | 零后端改动 | 纯前端实现，不涉及 API 调用 |

## 5. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| 内联金额遗漏 | 部分文件直接拼接 `¥` + 数字，可能遗漏改造 | 全局搜索 `¥` 和 `toFixed` 做全量排查 |
| 图表库限制 | 自定义图表组件的标签渲染方式可能不统一 | 逐个检查 BarChart/LineChart/PieChart 的标签格式化入口 |
| 格式化函数重构范围大 | 涉及 20+ 文件改动 | 先提交格式化重构 PR，再提交隐私模式 PR，分步验证 |

## 6. 不包含的内容（留待后续）

- 手势快捷操作（如双击隐藏）
- 按页面/模块单独控制隐藏
- 截屏保护（系统级，需原生模块支持）
- 密码/生物识别解锁才能查看金额
