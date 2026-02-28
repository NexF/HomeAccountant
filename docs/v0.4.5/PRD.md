# v0.4.5 — "我的账户"快捷管理

> **版本：v0.4.5**
> **创建日期：2026-02-28**
> **基于版本：v0.4.4**
> **状态：规划中**
> **本版本变更：新增面向普通用户的"我的账户"功能，以用户视角（银行卡、信用卡、股票账户等）管理资金账户，屏蔽会计科目概念**

---

## 1. 背景

### 1.1 核心矛盾：会计思维 vs 用户心智

当前系统的账户管理入口是"科目管理"（已在 v0.4.4 收入高级折叠区），采用会计科目树形结构。对于普通用户（小白）来说：

| 用户想做的事 | 系统要求用户理解的概念 |
|-------------|---------------------|
| "加一张招商银行储蓄卡" | 在 `1001 货币资金 > 1001-02 存款` 下新建子科目 |
| "加一个股票账户" | 在 `1101 短期投资` 下新建子科目 |
| "加一张信用卡" | 在 `2001 信用卡` 下新建子科目 |
| "看看我所有银行卡余额" | 展开资产类科目树，手动找到货币资金下的子科目 |

用户需要理解"科目"、"资产/负债类型"、"父子层级"等概念才能操作，门槛过高。

### 1.2 设计理念：双轨制

- **"我的账户"** — 面向普通用户，用日常语言（银行卡、信用卡、股票账户等）管理资金账户
- **"科目管理"** — 保留在高级区，面向懂会计的高级用户

两者操作的是同一套底层数据（科目树），只是展示和交互层面做了翻译。

## 2. 目标

| 能力 | 说明 |
|------|------|
| 账户分类展示 | 将资产/负债类叶子科目按用户可理解的分类展示（银行卡、信用卡、股票账户） |
| 快速添加账户 | 用户只需填写"名称"和"初始余额"，系统自动映射到正确的父科目 |
| 余额一览 | 每个账户直接显示当前余额，每个分类显示小计 |
| 桌面端/移动端一致 | 桌面端作为 DetailPane 展示，移动端 push 独立路由 |

## 3. 功能设计

### 3.1 入口位置

在"我的"页常用区新增菜单项，排在第 3 位（账本设置之后）：

```
┌──────────────────────────────────┐
│  ✎  编辑个人信息            >    │
│  📖 账本设置                >    │
│  💰 我的账户                >    │  ← 新增
│  🏢 固定资产                >    │
│  💳 贷款管理                >    │
│  📊 预算设置                >    │
│  📥 数据导入/导出           >    │
│  🏦 外部账户        即将推出 >    │
│                                  │
│  ⚙  高级                   ∨    │
│     📋 科目管理          >      │
│     ...                          │
└──────────────────────────────────┘
```

### 3.2 账户分类与科目映射

将用户可理解的"账户类型"映射到底层科目：

| 用户看到的分类 | 图标 | 对应的父科目 code | 科目 type | balance_direction |
|--------------|------|-------------------|-----------|-------------------|
| 银行卡 | `bank` | `1001-02`（存款） | asset | debit |
| 信用卡 | `credit-card` | `2001`（信用卡） | liability | credit |
| 股票账户 | `line-chart` | `1101`（短期投资） | asset | debit |

> 映射表定义为前端常量 `ACCOUNT_CATEGORY_MAP`，不需要后端改动。

### 3.3 页面布局

```
┌──────────────────────────────────┐
│  我的账户                   [+]  │  ← 标题栏 + 快速添加按钮
├──────────────────────────────────┤
│                                  │
│  🏦 银行卡               ¥20,545│  ← 分类标题 + 小计
│  ┌────────────────────────────┐  │
│  │ 招商银行储蓄卡  ¥12,345.00│  │
│  │ 工商银行工资卡  ¥ 8,200.00│  │
│  └────────────────────────────┘  │
│    + 添加银行卡                  │  ← 分类内快速添加
│                                  │
│  💳 信用卡               ¥-3,200│  ← 负数，绿色
│  ┌────────────────────────────┐  │
│  │ 招商银行信用卡  ¥-3,200.00│  │
│  └────────────────────────────┘  │
│    + 添加信用卡                  │
│                                  │
│  📈 股票账户             ¥70,000│
│  ┌────────────────────────────┐  │
│  │ 中信证券        ¥50,000.00│  │
│  │ 华泰证券        ¥20,000.00│  │
│  └────────────────────────────┘  │
│    + 添加股票账户                │
│                                  │
└──────────────────────────────────┘
```

### 3.4 分类展示规则

1. **只展示叶子科目**（`is_leaf === true`）——用户不需要看到中间层级
2. **按映射表分组**——每个账户归入其父科目对应的分类
3. **空分类也展示**——即使"股票账户"下没有任何子科目，也显示该分类和"+ 添加"按钮，引导用户创建
4. **余额着色**——资产类正数红色（`Colors.asset`），负债类绿色（`Colors.liability`），零值中性色
5. **分类小计**——每个分类标题右侧显示该分类下所有账户余额之和

### 3.5 快速添加账户

#### 3.5.1 入口

两个入口触发同一个 Modal：
- 右上角 `[+]` 按钮 — 弹出 Modal，需先选分类
- 分类内 `+ 添加xxx` — 弹出 Modal，分类已预选

#### 3.5.2 添加 Modal

```
┌──────────────────────────────┐
│        添加银行卡              │  ← 标题（含分类名）
│                              │
│  账户名称                    │
│  ┌──────────────────────┐   │
│  │                      │   │
│  └──────────────────────┘   │
│                              │
│  初始余额（可选）            │
│  ┌──────────────────────┐   │
│  │ 0.00                 │   │
│  └──────────────────────┘   │
│                              │
│  [  取消  ]  [  添加  ]     │
└──────────────────────────────┘
```

如果从右上角 `[+]` 进入，Modal 顶部增加分类选择：

```
┌──────────────────────────────┐
│          添加账户             │
│                              │
│  账户类型                    │
│  ┌────┐  ┌────┐  ┌────┐    │
│  │ 🏦 │  │ 💳 │  │ 📈 │    │
│  │银行卡│  │信用卡│  │股票 │    │
│  └────┘  └────┘  └────┘    │
│                              │
│  账户名称                    │
│  ┌──────────────────────┐   │
│  │                      │   │
│  └──────────────────────┘   │
│                              │
│  初始余额（可选）            │
│  ┌──────────────────────┐   │
│  │ 0.00                 │   │
│  └──────────────────────┘   │
│                              │
│  [  取消  ]  [  添加  ]     │
└──────────────────────────────┘
```

#### 3.5.3 提交逻辑

用户点击"添加"后，系统自动执行：

1. 根据所选分类，查找 `ACCOUNT_CATEGORY_MAP` 获取 `parent_id`（父科目 code → 通过科目树查找对应的科目 ID）
2. 调用 `accountService.createAccount(bookId, params)`:
   ```typescript
   {
     name: "招商银行储蓄卡",        // 用户输入
     type: "asset",                 // 由映射表决定
     balance_direction: "debit",    // 由映射表决定
     parent_id: "<存款科目的ID>",   // 由映射表 + 科目树查找决定
     icon: "bank",                  // 使用分类默认图标
   }
   ```
3. 如果用户填写了初始余额且不为 0，创建科目成功后再调用资产负债快照接口记录初始余额
4. 刷新科目树 `accountStore.fetchTree()`
5. 关闭 Modal，显示成功 Toast

### 3.6 账户行交互

| 操作 | 行为 |
|------|------|
| 点击账户行 | 进入该科目的详情页（复用现有的 `AccountDetailInline` 或移动端 `/accounts/[id]`） |
| 长按/右键（未来） | 预留，暂不实现 |

### 3.7 初始余额处理

用户填写的"初始余额"实际是该科目的期初余额。处理方式：

- 如果余额为 0 或未填写 → 仅创建科目，不做额外操作
- 如果余额不为 0 → 创建科目后，生成一笔**期初余额调整凭证**（借：该科目，贷：`3001 期初净资产`；或反向），使该科目余额等于用户输入值

> 此逻辑需要后端支持，参见 §6.2。

## 4. 涉及文件

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `client/features/profile/MyAccountsPane.tsx` | "我的账户"面板组件（桌面端 DetailPane） |
| `client/app/my-accounts/index.tsx` | "我的账户"移动端路由页面 |
| `client/constants/AccountCategoryMap.ts` | 账户分类 → 科目映射常量表 |

### 4.2 修改文件

| 文件 | 改动说明 |
|------|---------|
| `client/features/profile/types.ts` | `DetailPane` 增加 `'my-accounts'` |
| `client/app/(tabs)/profile.tsx` | 常用区菜单增加"我的账户"项 |
| `client/features/profile/DetailContent.tsx`（如有）| 增加 `my-accounts` → `MyAccountsPane` 的映射 |

### 4.3 后端改动（如需）

| 文件 | 改动说明 |
|------|---------|
| 凭证相关 API | 需支持"期初余额调整"凭证的创建（如已有则复用） |

## 5. 不涉及

- 不改动"科目管理"功能——高级用户仍可通过高级区使用完整科目树
- 不改动科目树数据结构——"我的账户"是科目树的一个视图层翻译
- 不新增后端科目相关 API——创建科目复用 `POST /books/{bookId}/accounts`
- 不改动记账流程——记账时仍选择科目，不受影响
- 不展示权益类/收入类/费用类科目——"我的账户"只关注资金账户（资产+负债中与钱直接相关的部分）

## 6. 技术方案

### 6.1 账户分类映射常量

```typescript
// client/constants/AccountCategoryMap.ts

export type AccountCategory = {
  key: string;           // 唯一标识
  label: string;         // 用户看到的分类名
  icon: string;          // FontAwesome 图标名
  parentCode: string;    // 对应的父科目 code
  accountType: 'asset' | 'liability';
  balanceDirection: 'debit' | 'credit';
  addLabel: string;      // "+ 添加xxx" 的文案
};

export const ACCOUNT_CATEGORIES: AccountCategory[] = [
  {
    key: 'bank',
    label: '银行卡',
    icon: 'bank',
    parentCode: '1001-02',   // 存款
    accountType: 'asset',
    balanceDirection: 'debit',
    addLabel: '添加银行卡',
  },
  {
    key: 'credit-card',
    label: '信用卡',
    icon: 'credit-card',
    parentCode: '2001',      // 信用卡
    accountType: 'liability',
    balanceDirection: 'credit',
    addLabel: '添加信用卡',
  },
  {
    key: 'stock',
    label: '股票账户',
    icon: 'line-chart',
    parentCode: '1101',      // 短期投资
    accountType: 'asset',
    balanceDirection: 'debit',
    addLabel: '添加股票账户',
  },
];
```

### 6.2 数据获取与分组逻辑

```typescript
// MyAccountsPane 内部

// 1. 从 accountStore 获取科目树
const { tree } = useAccountStore();

// 2. 递归查找指定 code 的科目节点
function findByCode(nodes: AccountTreeNode[], code: string): AccountTreeNode | null;

// 3. 对每个 category，找到父节点，取其 children（即叶子账户）
const categoryData = ACCOUNT_CATEGORIES.map(cat => {
  const allNodes = cat.accountType === 'liability' ? tree.liability : tree.asset;
  const parent = findByCode(allNodes, cat.parentCode);
  const accounts = parent?.children.filter(c => c.is_active) ?? [];
  const subtotal = accounts.reduce((sum, a) => sum + a.balance, 0);  // 注：需要余额数据
  return { ...cat, accounts, subtotal, parentId: parent?.id };
});
```

> **余额数据来源**：科目树 `AccountTreeNode` 当前不包含 `balance` 字段。需要结合资产负债表数据（`balanceSheetService`）或在科目树 API 返回中增加余额信息。具体方案在技术实现时确定，此处预留。

### 6.3 创建账户逻辑

```typescript
async function handleCreate(categoryKey: string, name: string, initialBalance?: number) {
  const cat = ACCOUNT_CATEGORIES.find(c => c.key === categoryKey);
  const parentNode = findByCode(tree, cat.parentCode);

  // 1. 创建科目
  await accountService.createAccount(bookId, {
    name,
    type: cat.accountType,
    balance_direction: cat.balanceDirection,
    parent_id: parentNode.id,
    icon: cat.icon,
  });

  // 2. 如果有初始余额，创建期初调整凭证（需后端支持）
  if (initialBalance && initialBalance !== 0) {
    // TODO: 调用凭证 API 创建期初余额调整
  }

  // 3. 刷新
  await accountStore.fetchTree(bookId);
}
```

### 6.4 路由与 DetailPane

```typescript
// types.ts — DetailPane 增加
export type DetailPane = ... | 'my-accounts';

// profile.tsx — 菜单项
<MenuItem
  icon="dollar"
  label="我的账户"
  onPress={() => handleMenuPress('my-accounts', '/my-accounts')}
/>

// DetailContent 映射
case 'my-accounts': return <MyAccountsPane />;
```

### 6.5 Modal 样式

复用设计规范第 10 条 Modal 样式（与对账 Modal、新增科目 Modal 一致）：
- `overlay`: `rgba(0,0,0,0.4)` 全屏遮罩
- `content`: `width: 85%`, `maxWidth: 420`, `borderRadius: 14`, `padding: 24`
- `title`: `fontSize: 17`, `fontWeight: 600`, `textAlign: center`
- 按钮: `flex: 1`, `height: 44`, `borderRadius: 10`

## 7. 交互细节

### 7.1 空状态

如果用户从未创建任何自定义账户（只有系统预置科目），页面显示空状态引导：

```
┌──────────────────────────────────┐
│           我的账户                │
│                                  │
│      💰                         │
│   还没有添加任何账户              │
│   点击下方按钮开始管理你的资金     │
│                                  │
│        [ + 添加账户 ]            │
│                                  │
└──────────────────────────────────┘
```

### 7.2 分类折叠

- 每个分类默认展开
- 点击分类标题行可折叠/展开该分类下的账户列表
- 折叠时仍显示分类名和小计金额

### 7.3 账户行样式

| 元素 | 样式 |
|------|------|
| 账户名称 | `fontSize: 15`, 左对齐 |
| 余额 | `fontSize: 15`, `fontVariant: tabular-nums`, 右对齐 |
| 资产正余额颜色 | `Colors.asset`（红色） |
| 负债余额颜色 | `Colors.liability`（绿色） |
| 零余额颜色 | `colors.textSecondary` |
| 行高 | `48px`，垂直居中 |
| 行间分隔 | `borderBottomWidth: StyleSheet.hairlineWidth`, `borderColor: colors.border` |

### 7.4 "添加"按钮样式

- 文案：`+ 添加银行卡` / `+ 添加信用卡` 等（由 `addLabel` 决定）
- 颜色：`Colors.primary`
- 大小：`fontSize: 14`
- 对齐：左对齐，与账户行同缩进
- 行高：`40px`

## 8. 验收标准

| 编号 | 项目 | 验收条件 |
|------|------|---------|
| AC-1 | 入口可达 | "我的"页常用区显示"我的账户"菜单项，点击后打开对应页面 |
| AC-2 | 分类展示 | 页面按 3 个分类（银行卡、信用卡、股票账户）分组展示 |
| AC-3 | 账户列表 | 每个分类下展示对应父科目的叶子子科目，显示名称和余额 |
| AC-4 | 分类小计 | 每个分类标题右侧显示该分类下所有账户余额之和 |
| AC-5 | 快速添加（分类内） | 点击"+ 添加xxx"弹出 Modal，仅需填写名称和初始余额即可创建 |
| AC-6 | 快速添加（全局） | 点击右上角 `+` 按钮弹出 Modal，需先选择分类再填写 |
| AC-7 | 科目映射正确 | 创建的科目 parent_id、type、balance_direction 与映射表一致 |
| AC-8 | 账户详情 | 点击账户行可进入该科目的详情页（复用现有逻辑） |
| AC-9 | 空状态 | 无自定义账户时展示引导页 |
| AC-10 | 桌面端 | 桌面端作为 DetailPane 在右侧面板展示 |
| AC-11 | 移动端 | 移动端 push `/my-accounts` 路由页面 |
| AC-12 | 科目管理不受影响 | 高级区"科目管理"功能正常，可看到通过"我的账户"创建的科目 |
| AC-13 | Modal 样式 | 添加账户 Modal 符合设计规范第 10 条 |

## 9. 后续迭代（不在本版本范围）

| 功能 | 说明 |
|------|------|
| 现金分类 | 增加 `1001-01 现金` 映射 |
| 货币基金分类 | 增加 `1002-01 货币基金` 映射 |
| 长期投资分类 | 增加 `1201 长期投资` 映射，区分短期/长期投资 |
| 账户排序/置顶 | 允许用户拖拽排序或置顶常用账户 |
| 账户图标自定义 | 添加时可选择银行 logo 图标 |
| 账户最近交易 | 每个账户卡片下展示最近 3-5 条交易 |
| 余额趋势迷你图 | 账户行右侧显示近 30 天余额趋势 sparkline |
| 资产负债表"+"入口 | 在资产负债表报表页的各分类旁增加"+"按钮，共用快速添加逻辑 |
