# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.1.1**
> **创建日期：2026-02-13**
> **基于版本：v0.0.3**
> **状态：规划中**
> **本版本变更：分录完整编辑（科目、金额、所有业务字段）**

---

## 1. 技术架构概述

v0.1.1 涉及前后端同步改动，无架构层面变更：

- **前端**：React Native + Expo + TypeScript + Zustand（不变）
- **后端**：Python FastAPI + SQLAlchemy + SQLite（不变）

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **后端 Schema** | `server/app/schemas/entry.py` | 修改 | `EntryUpdateRequest` 扩展为支持全部业务字段 |
| **后端 Service** | `server/app/services/entry_service.py` | 修改 | `update_entry()` 重写为"删旧行+建新行"逻辑 |
| **后端 Router** | `server/app/routers/entries.py` | 修改 | `edit_entry` 端点适配新 schema，按 entry_type 分发校验 |
| **前端页面** | `client/app/entry/new.tsx` | 修改 | 支持编辑模式（`editId` 参数）、预填数据、锁定 entry_type |
| **前端页面** | `client/app/entry/[id].tsx` | 修改 | 移除内联编辑，改为纯只读 + 编辑按钮跳转 |
| **前端组件** | `client/app/(tabs)/ledger.tsx` | 修改 | `EntryDetailPane` 移除内联编辑，编辑按钮跳转 |
| **前端 Service** | `client/services/entryService.ts` | 修改 | `EntryUpdateParams` 扩展字段，适配新 API |

---

## 2. 后端实现方案

### 2.1 Schema 扩展

**文件：`server/app/schemas/entry.py`**

将 `EntryUpdateRequest` 从 3 个字段扩展为与 `EntryCreateRequest` 一致的字段集（不含 `entry_type` 和联动字段）：

```python
class EntryUpdateRequest(BaseModel):
    """分录完整编辑请求 — 除 entry_type 外，所有业务字段均可修改"""

    # 元数据
    entry_date: date | None = None
    description: str | None = Field(None, max_length=500)
    note: str | None = None

    # 金额
    amount: Decimal | None = Field(None, gt=0)

    # 科目 ID
    category_account_id: str | None = None
    payment_account_id: str | None = None
    asset_account_id: str | None = None
    liability_account_id: str | None = None
    from_account_id: str | None = None
    to_account_id: str | None = None
    extra_liability_account_id: str | None = None
    extra_liability_amount: Decimal | None = Field(None, ge=0)

    # repay 专用
    principal: Decimal | None = Field(None, ge=0)
    interest: Decimal | None = Field(None, ge=0)

    # manual 专用
    lines: list[JournalLineCreate] | None = None
```

> **不包含的字段**：`entry_type`（不可变更）、`asset_name`/`useful_life_months`/`residual_rate`/`depreciation_method`/`depreciation_granularity`（固定资产联动）、`loan_name`/`annual_rate`/`total_months`/`repayment_method`/`start_date`（贷款联动）。

### 2.2 Service 层重写

**文件：`server/app/services/entry_service.py`**

**核心策略：删旧行 + 建新行**

`update_entry()` 函数重写逻辑：

```python
async def update_entry(
    db: AsyncSession,
    entry: JournalEntry,
    body: EntryUpdateRequest,
) -> JournalEntry:
    """
    完整编辑分录：
    1. 更新元数据（entry_date, description, note）
    2. 如果提供了业务字段（amount, account_id 等），删除旧 lines 并重新生成
    3. 校验借贷平衡
    4. entry.id 和 created_at 不变
    """

    # Step 1: 更新元数据
    if body.entry_date is not None:
        entry.entry_date = body.entry_date
    if body.description is not None:
        entry.description = body.description
    if body.note is not None:
        entry.note = body.note

    # Step 2: 判断是否需要重建 lines
    has_business_fields = _has_business_fields(body)

    if has_business_fields:
        # Step 2a: 删除旧的 journal_lines
        await db.execute(
            delete(JournalLine).where(JournalLine.entry_id == entry.id)
        )

        # Step 2b: 按 entry_type 重新生成 lines
        new_lines = _build_lines(db, entry, body)
        for line in new_lines:
            db.add(line)

        # Step 2c: 校验借贷平衡
        _check_balance(new_lines)

    await db.flush()
    await db.refresh(entry)
    return entry
```

**分录行生成函数 `_build_lines()`：**

从现有的 7 个 `create_xxx_entry()` 函数中提取分录行构造逻辑，封装为可复用的 `_build_lines()` 函数，按 `entry.entry_type` 分发：

```python
def _build_lines(
    db: AsyncSession,
    entry: JournalEntry,
    body: EntryUpdateRequest,
) -> list[JournalLine]:
    """按 entry_type 构造 journal_lines"""

    match entry.entry_type:
        case "expense":
            return _build_expense_lines(entry, body)
        case "income":
            return _build_income_lines(entry, body)
        case "asset_purchase":
            return _build_asset_purchase_lines(entry, body)
        case "borrow":
            return _build_borrow_lines(entry, body)
        case "repay":
            return _build_repay_lines(entry, body)
        case "transfer":
            return _build_transfer_lines(entry, body)
        case "manual":
            return _build_manual_lines(entry, body)
        case _:
            raise EntryError(f"不支持的分录类型: {entry.entry_type}")
```

**各类型的分录行构造规则（与 create 完全一致）：**

| entry_type | 借方 | 贷方 | 必填字段校验 |
|-----------|------|------|------------|
| expense | `category_account_id` (amount) | `payment_account_id` (amount) | amount, category_account_id, payment_account_id |
| income | `payment_account_id` (amount) | `category_account_id` (amount) | amount, category_account_id, payment_account_id |
| transfer | `to_account_id` (amount) | `from_account_id` (amount) | amount, from_account_id, to_account_id |
| asset_purchase | `asset_account_id` (amount) | `payment_account_id` (amount - extra) + `extra_liability_account_id` (extra) | amount, asset_account_id, payment_account_id |
| borrow | `payment_account_id` (amount) | `liability_account_id` (amount) | amount, payment_account_id, liability_account_id |
| repay | `liability_account_id` (principal) + `category_account_id` (interest) | `payment_account_id` (principal+interest) | principal, payment_account_id, liability_account_id |
| manual | 用户自定义 lines | 用户自定义 lines | lines 非空 |

### 2.3 Router 层适配

**文件：`server/app/routers/entries.py`**

```python
@router.put("/entries/{entry_id}", response_model=EntryDetailResponse)
async def edit_entry(
    entry_id: str,
    body: EntryUpdateRequest,   # 扩展后的 schema
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """编辑分录（支持修改科目、金额等全部业务字段）"""

    # 1. 查询分录并校验权限
    entry = await _get_entry_with_auth(db, entry_id, user)

    # 2. 如果提供了科目 ID，校验科目存在性
    await _validate_accounts(db, entry, body)

    # 3. 调用 service 更新
    updated = await update_entry(db, entry, body)

    # 4. 重新加载完整数据（含 lines + account_name）
    return await _load_entry_detail(db, updated.id)
```

**科目校验 `_validate_accounts()`：**

遍历 body 中所有 `*_account_id` 字段，对每个非 None 的 ID 调用 `_get_account()` 校验：
- 科目存在
- 科目属于该账本
- 科目未停用

### 2.4 代码重构：提取分录行构造逻辑

当前 `entry_service.py` 的 7 个 `create_xxx_entry()` 函数各自内联了分录行构造逻辑。为避免重复，需要提取为共用函数：

**重构策略：**

1. 从每个 `create_xxx_entry()` 中提取分录行构造部分为 `_build_xxx_lines()` 函数
2. `create_xxx_entry()` 调用 `_build_xxx_lines()` + 创建 `JournalEntry` + 处理联动实体
3. `_build_lines()` 在更新时调用对应的 `_build_xxx_lines()`
4. 创建和更新共享同一套分录行构造逻辑，保证一致性

```
                  create_expense_entry()
                    ├── 创建 JournalEntry
                    ├── _build_expense_lines()  ← 共用
                    └── flush

update_entry()
  ├── 更新元数据
  ├── 删除旧 lines
  ├── _build_expense_lines()  ← 共用
  ├── _check_balance()
  └── flush
```

---

## 3. 前端实现方案

### 3.1 `entryService.ts` — API 层扩展

**文件：`client/services/entryService.ts`**

扩展 `EntryUpdateParams` 类型：

```typescript
export type EntryUpdateParams = {
  // 元数据
  entry_date?: string;
  description?: string;
  note?: string;

  // 金额
  amount?: number;

  // 科目 ID
  category_account_id?: string;
  payment_account_id?: string;
  asset_account_id?: string;
  liability_account_id?: string;
  from_account_id?: string;
  to_account_id?: string;
  extra_liability_account_id?: string;
  extra_liability_amount?: number;

  // repay 专用
  principal?: number;
  interest?: number;

  // manual 专用
  lines?: { account_id: string; debit_amount: number; credit_amount: number }[];
};
```

`updateEntry()` 方法不变（仍为 `PUT /entries/{id}`），仅 payload 类型扩展。

### 3.2 `entry/new.tsx` — 新建/编辑双模式

**文件：`client/app/entry/new.tsx`**

#### 3.2.1 路由参数

```typescript
const { editId } = useLocalSearchParams<{ editId?: string }>();
const isEditMode = !!editId;
```

#### 3.2.2 编辑模式初始化

页面加载时，如果 `editId` 存在，请求分录详情并预填表单：

```typescript
useEffect(() => {
  if (!editId) return;

  entryService.getEntry(editId).then(({ data }) => {
    // 1. 锁定 entry_type
    setEntryType(data.entry_type);

    // 2. 预填元数据
    setDescription(data.description ?? '');
    setNote(data.note ?? '');
    setDate(data.entry_date);

    // 3. 预填金额（从 lines 中提取）
    setAmount(extractAmount(data));

    // 4. 预填科目（从 lines 中反向推导）
    prefillAccounts(data);
  });
}, [editId]);
```

#### 3.2.3 科目预填函数

```typescript
function prefillAccounts(entry: EntryDetailResponse) {
  const debitLines = entry.lines.filter(l => Number(l.debit_amount) > 0);
  const creditLines = entry.lines.filter(l => Number(l.credit_amount) > 0);

  switch (entry.entry_type) {
    case 'expense':
      // 借方 = 费用科目, 贷方 = 支付账户
      setCategoryAccount(toAccountNode(debitLines[0]));
      setPaymentAccount(toAccountNode(creditLines[0]));
      break;

    case 'income':
      // 借方 = 收款账户, 贷方 = 收入科目
      setPaymentAccount(toAccountNode(debitLines[0]));
      setCategoryAccount(toAccountNode(creditLines[0]));
      break;

    case 'transfer':
      // 借方 = 目标, 贷方 = 来源
      setToAccount(toAccountNode(debitLines[0]));
      setFromAccount(toAccountNode(creditLines[0]));
      break;

    case 'asset_purchase':
      // 借方 = 资产科目
      setAssetAccount(toAccountNode(debitLines[0]));
      // 贷方可能有 1-2 行（支付账户 + 可选负债）
      for (const line of creditLines) {
        // 按 account_type 区分
        if (line.account_type === 'liability') {
          setExtraLiabilityAccount(toAccountNode(line));
          setExtraLiabilityAmount(Number(line.credit_amount));
        } else {
          setPaymentAccount(toAccountNode(line));
        }
      }
      break;

    case 'borrow':
      setPaymentAccount(toAccountNode(debitLines[0]));
      setLiabilityAccount(toAccountNode(creditLines[0]));
      break;

    case 'repay':
      // 借方可能有 2 行（负债本金 + 利息费用）
      for (const line of debitLines) {
        if (line.account_type === 'liability') {
          setLiabilityAccount(toAccountNode(line));
          setPrincipal(Number(line.debit_amount));
        } else if (line.account_type === 'expense') {
          setCategoryAccount(toAccountNode(line));
          setInterest(Number(line.debit_amount));
        }
      }
      setPaymentAccount(toAccountNode(creditLines[0]));
      break;
  }
}
```

#### 3.2.4 辅助函数

```typescript
/** 从 line 数据构造 AccountTreeNode 用于科目选择器预填 */
function toAccountNode(line: JournalLineResponse): AccountTreeNode {
  return {
    id: line.account_id,
    name: line.account_name ?? '',
    code: line.account_code ?? '',
    account_type: line.account_type ?? '',
    children: [],
  };
}

/** 从分录详情中提取主金额 */
function extractAmount(entry: EntryDetailResponse): string {
  switch (entry.entry_type) {
    case 'expense':
    case 'income':
    case 'transfer':
    case 'borrow':
      return Math.abs(Number(entry.lines[0]?.debit_amount || entry.lines[0]?.credit_amount || 0)).toString();

    case 'asset_purchase':
      // 借方第一行的金额
      return Number(entry.lines.find(l => Number(l.debit_amount) > 0)?.debit_amount || 0).toString();

    case 'repay':
      // principal + interest 需要分别设置，不设 amount
      return '0';

    default:
      return '0';
  }
}
```

#### 3.2.5 entry_type 锁定

编辑模式下，类型 Tab 不可切换：

```typescript
// 类型切换 Tab
{ENTRY_TYPES.map(type => (
  <Pressable
    key={type.key}
    disabled={isEditMode}                    // ← 编辑模式禁用
    style={[
      styles.typeTab,
      activeType === type.key && styles.typeTabActive,
      isEditMode && styles.typeTabLocked,     // ← 灰色样式
    ]}
    onPress={() => !isEditMode && setEntryType(type.key)}
  >
    <Text ...>{type.label}</Text>
  </Pressable>
))}
```

#### 3.2.6 保存逻辑

```typescript
const handleSave = async () => {
  const params = buildParams(); // 构造请求参数（与新建一致）

  if (isEditMode) {
    // 编辑模式：PUT 更新
    await entryService.updateEntry(editId!, params);
  } else {
    // 新建模式：POST 创建
    await entryService.createEntry(bookId, params);
  }

  router.back();
};
```

#### 3.2.7 标题和折旧/贷款区域

```typescript
// 页面标题
<Text style={styles.headerTitle}>
  {isEditMode ? '编辑分录' : '记一笔'}
</Text>

// 折旧设置区域（编辑模式下隐藏）
{!isEditMode && isFixedAssetAccount && (
  <DepreciationSettings ... />
)}

// 贷款设置区域（编辑模式下隐藏）
{!isEditMode && showLoanSettings && (
  <LoanSettings ... />
)}
```

### 3.3 `entry/[id].tsx` — 改为纯只读

**文件：`client/app/entry/[id].tsx`**

移除所有编辑相关的 state 和逻辑：

```diff
- const [editing, setEditing] = useState(false);
- const [editDesc, setEditDesc] = useState('');
- const [editNote, setEditNote] = useState('');
- const [editDate, setEditDate] = useState('');
- const [saving, setSaving] = useState(false);
- const handleSave = async () => { ... };
```

编辑按钮改为跳转：

```typescript
<Pressable
  onPress={() => router.push(`/entry/new?editId=${entry.id}` as any)}
  style={styles.headerBtn}
>
  <FontAwesome name="pencil" size={18} color={Colors.primary} />
</Pressable>
```

所有字段改为纯文本展示，移除 `TextInput` 切换逻辑。

添加 `useFocusEffect` 在页面重新获得焦点时刷新数据（编辑返回后自动更新）：

```typescript
useFocusEffect(
  useCallback(() => {
    fetchDetail();
  }, [id])
);
```

### 3.4 `ledger.tsx` — `EntryDetailPane` 简化

**文件：`client/app/(tabs)/ledger.tsx`**

`EntryDetailPane` 移除所有编辑 state 和逻辑（`editing`、`editDesc`、`editNote`、`editDate`、`saving`、`handleSave`），改为纯只读 + 编辑跳转按钮：

```typescript
const router = useRouter();

// 编辑按钮
<Pressable
  onPress={() => router.push(`/entry/new?editId=${entryId}` as any)}
  style={styles.headerBtn}
>
  <FontAwesome name="pencil" size={18} color={Colors.primary} />
</Pressable>
```

> **注意**：这里 `router.push` 跳转是合理的，因为 `entry/new.tsx` 是全屏路由页面（不属于右侧面板内导航），与设计规范第 3 节一致——"记账"本身就是一个全屏 Stack 页面。

添加 `entryId` 变化或页面聚焦时刷新数据的逻辑，确保编辑返回后右侧面板数据更新。

### 3.5 分录详情 API 响应字段补充

为支持科目预填，需要确认 `GET /entries/{entry_id}` 返回的 `lines` 中包含以下字段：

| 字段 | 用途 | 当前状态 |
|------|------|---------|
| `account_id` | 科目 ID | ✅ 已有 |
| `account_name` | 科目名称（显示用） | ✅ 已有 |
| `account_code` | 科目代码（反向推导用） | ⚠️ 需确认 |
| `account_type` | 科目类型（asset/liability/equity/income/expense） | ⚠️ 需确认 |
| `debit_amount` | 借方金额 | ✅ 已有 |
| `credit_amount` | 贷方金额 | ✅ 已有 |

如果 `account_code` 或 `account_type` 缺失，需要在后端 `_to_detail()` 函数中补充 join 查询。

---

## 4. 开发实施计划

### 阶段 1：后端 API 扩展（预计 1.5 天）

1. **重构 `entry_service.py`**：从 7 个 `create_xxx_entry()` 中提取 `_build_xxx_lines()` 函数
2. **扩展 `EntryUpdateRequest`** schema（新增业务字段）
3. **重写 `update_entry()`**：实现删旧行+建新行逻辑
4. **适配 `edit_entry` router**：科目校验、按 entry_type 分发
5. **确认分录详情 API 返回 `account_type` 和 `account_code`**，缺失则补充
6. **单元测试**：编辑各类型分录的正确性、借贷平衡校验、科目校验

### 阶段 2：前端编辑模式（预计 2 天）

1. **扩展 `entryService.ts`** 的 `EntryUpdateParams` 类型
2. **改造 `entry/new.tsx`**：
   - 读取 `editId` 参数，区分新建/编辑模式
   - 编辑模式下请求分录详情、预填表单
   - entry_type Tab 锁定
   - 折旧/贷款区域隐藏
   - 保存逻辑分发（POST vs PUT）
3. **实现 `prefillAccounts()` 和 `extractAmount()`**：从 lines 反向推导科目和金额
4. **测试**：6 种 entry_type 的预填、编辑、保存

### 阶段 3：详情页简化 + 联调（预计 1 天）

1. **简化 `entry/[id].tsx`**：移除内联编辑，改为纯只读 + 编辑跳转
2. **简化 `EntryDetailPane`**（`ledger.tsx`）：移除编辑 state，编辑按钮跳转
3. **添加 `useFocusEffect` 刷新**：编辑返回后自动更新数据
4. **端到端测试**：手机端流程 + 桌面端流程
5. **深色模式 + 响应式验证**

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 后端 API 扩展 + 重构 | 1.5 天 | 1.5 天 |
| 2 | 前端编辑模式 | 2 天 | 3.5 天 |
| 3 | 详情页简化 + 联调 | 1 天 | 4.5 天 |

> v0.1.1 总计约 **4.5 个工作日**。

---

## 5. 依赖变更

### 5.1 后端

无新增依赖。

### 5.2 前端

无新增依赖。

---

## 6. 测试要点

### 6.1 后端测试

| 测试用例 | 预期结果 |
|---------|---------|
| PUT 仅更新元数据（date/desc/note） | 只更新元数据，lines 不变 |
| PUT 更新 expense 分录（改科目+金额） | 旧 lines 删除，新 lines 生成，借贷平衡 |
| PUT 更新 income 分录 | 同上 |
| PUT 更新 transfer 分录 | 同上 |
| PUT 更新 asset_purchase 分录 | 同上，联动的固定资产不受影响 |
| PUT 更新 borrow 分录 | 同上，联动的贷款不受影响 |
| PUT 更新 repay 分录（改本金+利息） | 新 lines 金额正确 |
| PUT 更新 manual 分录 | 用户自定义 lines 替换旧 lines |
| PUT 传入不存在的科目 ID | 返回 404 错误 |
| PUT 传入已停用的科目 | 返回 400 错误 |
| PUT 传入借贷不平衡的 lines | 返回 400 错误 |
| PUT 不传业务字段（仅元数据） | 兼容旧行为，只更新元数据 |
| 编辑后分录 ID 不变 | `entry.id` 和 `created_at` 不变 |
| 编辑后分录 `updated_at` 更新 | 时间戳更新 |

### 6.2 前端测试

| 测试用例 | 预期结果 |
|---------|---------|
| 详情页点编辑 → 跳转 new.tsx | URL 包含 `editId` 参数 |
| 编辑页标题显示"编辑分录" | 非"记一笔" |
| entry_type Tab 灰色锁定 | 不可切换 |
| 6 种类型分录的科目预填正确 | 科目选择器显示已选科目 |
| 金额预填正确 | 金额键盘显示已有金额 |
| 日期/摘要/备注预填正确 | 输入框显示已有值 |
| 折旧设置区域隐藏（编辑模式） | asset_purchase 编辑时不显示折旧设置 |
| 贷款设置区域隐藏（编辑模式） | borrow/asset_purchase 编辑时不显示贷款设置 |
| 保存成功后返回 | 详情页/列表数据刷新 |
| 保存失败 Toast 提示 | 显示错误信息 |
| 桌面端详情面板编辑按钮 | 跳转到 new.tsx 全屏页面 |
| 编辑返回后桌面端右侧面板刷新 | 数据更新 |
| 新建模式不受影响 | 无 editId 时行为与之前完全一致 |

---

## 7. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 科目反向推导逻辑复杂 | asset_purchase 和 repay 有多行 lines，需按 account_type 区分 | 后端确保 lines 中返回 `account_type` 字段 |
| 分录详情缺少 `account_type`/`account_code` 字段 | 前端无法正确反向推导 | 阶段 1 首先确认并补充 |
| 联动实体（固定资产/贷款）编辑不同步 | 用户编辑了 asset_purchase 分录金额，但固定资产原值不变 | PRD 已明确：编辑不影响联动实体，文案提示用户 |
| entry_type 锁定可能困惑用户 | 用户想把"费用"改成"收入" | 提示"如需更改类型请删除后重新创建" |
| 后端重构影响创建逻辑 | 提取 _build_xxx_lines() 可能引入 bug | 创建分录的单元测试全部通过后再进行 |
