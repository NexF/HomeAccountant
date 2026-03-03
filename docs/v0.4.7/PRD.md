# v0.4.7 — 对账机制优化：取消待处理队列 + 插件自动调账

> **版本：v0.4.7**
> **创建日期：2026-03-02**
> **基于版本：v0.4.6（插件多账本同步）**
> **状态：规划中**
> **本版本变更：取消"待处理对账"功能，改为插件余额同步时自动生成调账分录；用户手动对账行为保留但简化**

---

## 1. 背景

### 1.1 当前问题

v0.3 引入了余额快照 + 对账机制：提交余额快照后，如果账面余额与实际余额存在差异，系统自动生成一笔 `reconciliation_status = "pending"` 的调节分录，进入"待处理对账"队列，用户需手动确认分类（选择差异归属的科目）或拆分。

**实际使用中的问题：**

| 问题 | 说明 |
|------|------|
| 噪音过多 | 插件每天自动同步余额，证券账户因股价波动每天都有差异 → 待处理堆积 |
| 用户不会处理 | "待处理对账"需要用户理解差异含义并手动分类，操作门槛高，大多数用户直接忽略 |
| 差异含义不同 | 证券账户差异 = 投资损益（正常波动），银行账户差异 = 漏记交易，两者处理方式完全不同，但系统没有区分 |

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 消除噪音 | 取消"待处理对账"功能，删除 pending 队列和相关 UI |
| 插件自动调账 | 插件通过配置指定调账科目，余额快照有差异时自动生成已确认的调账分录 |
| 保留手动对账 | 用户在科目详情页/资产负债表中输入真实余额仍可对账，差异使用系统默认科目自动生成已确认的分录 |
| 简化流程 | 对账调节分录不再有 `pending` 状态，统一为直接生效 |

## 2. 方案设计

### 2.1 核心变更总览

| 项目 | 变更前 (v0.3~v0.4.6) | 变更后 (v0.4.7) |
|------|----------------------|-----------------|
| 余额快照有差异时 | 生成 pending 调节分录 → 进入待处理队列 | 直接生成已确认的调节分录（使用指定科目） |
| 调节分录科目 | 暂挂到"待分类收入/费用"，等用户确认 | 直接使用插件配置的调账科目 / 系统默认科目 |
| `reconciliation_status` | `none` / `pending` / `confirmed` | 移除该字段（所有分录直接生效） |
| 待处理对账队列 | Dashboard 角标 + 独立页面 + 确认/拆分接口 | 删除 |
| 用户手动对账 | 输入余额 → pending → 手动确认科目 | 输入余额 → 直接生成分录（使用默认科目） |

### 2.2 调账科目来源

| 场景 | 调账科目来源 | 说明 |
|------|-------------|------|
| 插件余额同步（已配置调账科目） | 插件 `config_schema` 中的 `adjust_account_id` 字段 | 用户在插件配置中选择，如"投资收益" |
| 插件余额同步（未配置调账科目） | 系统默认科目：差异 > 0 用"其他收入"，差异 < 0 用"其他费用" | 回退到与手动对账相同的逻辑 |
| 用户手动对账（科目详情页/资产负债表） | 系统默认科目：差异 > 0 用"其他收入"，差异 < 0 用"其他费用" | 用户无需选择，一步完成 |

### 2.3 插件调账科目配置

#### 2.3.1 CONFIG_SCHEMA 扩展

每个需要余额同步的插件，在 `CONFIG_SCHEMA` 中新增一个 `account_select` 类型的字段用于指定调账科目：

**东方财富 / 长桥证券插件**（证券类）：

```json
{
  "key": "adjust_account_id",
  "label": "调账科目",
  "type": "account_select",
  "required": false,
  "depends_on": "target_book",
  "description": "余额差异自动调账的目标科目（如投资收益），不设则使用系统默认科目（其他收入/其他费用）"
}
```

**微信银行监控插件**（银行类）：

```json
{
  "key": "adjust_account_id",
  "label": "调账科目",
  "type": "account_select",
  "required": false,
  "depends_on": "target_book",
  "description": "余额差异自动调账的目标科目（如其他收入/费用），不设则使用系统默认科目（其他收入/其他费用）"
}
```

> 所有具备余额同步功能的插件都应提供 `adjust_account_id` 配置字段。不设置时回退到系统默认科目（差异 > 0 用"其他收入"，差异 < 0 用"其他费用"），确保余额快照有差异时**一定会生成调账分录**，让账面余额与实际余额保持一致。

#### 2.3.2 调账科目的语义

| 插件类型 | 推荐调账科目 | 会计含义 |
|----------|-------------|---------|
| 证券类（东财/长桥） | 投资收益（收入科目） | 股价波动带来的浮盈浮亏 |
| 银行类（微信银行监控） | 其他收入 / 其他费用 | 差异可能是漏记交易或利息等，用户后续可补记并冲销 |

#### 2.3.3 多账本模式适配

`adjust_account_id` 遵循 v0.4.6 多账本规则：`depends_on: "target_book"`，在多账本模式下值为 `{book_id: account_id}` 映射对象，每个账本可配置不同的调账科目。

### 2.4 调账分录生成逻辑

当余额快照检测到差异（`|difference| >= 0.01`）：

#### 2.4.1 插件触发（有调账科目配置时）

- 差异 > 0（实际 > 账面，如投资浮盈）：
  - 借：目标资产科目（如"长桥证券"）
  - 贷：调账科目（如"投资收益"）
- 差异 < 0（实际 < 账面，如投资浮亏）：
  - 借：调账科目（如"投资收益"，反向冲减）
  - 贷：目标资产科目（如"长桥证券"）
- `entry_type` = `"reconciliation"`
- `reconciliation_status` 不再使用，分录直接生效
- `source` = `"reconciliation"`
- `description` = `"余额调节：{科目名}"`

#### 2.4.2 插件触发（无调账科目配置时）

- 回退到系统默认科目，行为与用户手动对账一致：
  - 差异 > 0：借：目标资产科目，贷：**其他收入**（code `4009`）
  - 差异 < 0：借：**其他费用**（code `5099`），贷：目标资产科目
- 其余字段同 §2.4.1

#### 2.4.3 用户手动触发（科目详情页 / 资产负债表）

行为与之前类似，但不再进入 pending 队列：

- 差异 > 0：借：目标科目，贷：**其他收入**（系统默认科目，code `4009`）
- 差异 < 0：借：**其他费用**（系统默认科目，code `5099`），贷：目标科目
- 分录直接生效，`reconciliation_status` 不再使用

> 默认科目 `4009`（其他收入）和 `5099`（其他费用）需确认系统中已存在，否则使用最接近的系统预置科目。

## 3. 删除内容清单

### 3.1 删除的后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/books/{book_id}/pending-reconciliations` | 获取待处理队列 |
| `GET` | `/books/{book_id}/pending-count` | 待处理数量 |
| `PUT` | `/entries/{entry_id}/confirm` | 确认调节分录分类 |
| `POST` | `/entries/{entry_id}/split` | 拆分调节分录 |

> `POST /accounts/{account_id}/snapshot` **保留**，但逻辑简化。

### 3.2 删除的前端页面/组件

| 文件 | 说明 |
|------|------|
| `client/app/sync/reconcile.tsx` | 待处理对账页面 |
| `client/features/sync/ReconcileCard.tsx` | 对账卡片组件 |
| `client/features/sync/BalanceCompare.tsx` | 余额对比组件 |
| `client/features/sync/index.ts` | sync 模块导出 |

### 3.3 删除/清理的数据模型字段

| 模型 | 字段 | 处理方式 |
|------|------|---------|
| `JournalEntry` | `reconciliation_status` | 移除字段（已有数据中 `pending` 改为不再使用） |
| `JournalEntry` | 复合索引 `ix_journal_entries_book_reconciliation` | 删除索引 |
| `BalanceSnapshot` | `status` 枚举 | 从 `balanced/pending/reconciled` 简化为 `balanced/reconciled` |

### 3.4 删除的前端 UI 入口

| 位置 | 删除内容 |
|------|---------|
| Dashboard（`index.tsx`） | "待处理对账"角标和点击跳转 |
| 路由布局（`_layout.tsx`） | `sync/reconcile` 路由注册 |
| `syncService.ts` | `getPendingReconciliations`、`getPendingCount`、`confirmReconciliation`、`splitReconciliation` 方法 |

## 4. 保留内容

### 4.1 保留的后端 API

| 方法 | 路径 | 变更 |
|------|------|------|
| `POST` | `/accounts/{account_id}/snapshot` | **简化**：不再生成 pending 分录，改为根据是否配置调账科目决定是否自动调账 |

### 4.2 保留的前端功能

| 位置 | 说明 |
|------|------|
| 科目详情页对账区域（`accounts/[id].tsx`、`AccountsPane.tsx`） | **保留**，输入真实余额后直接生成已确认的调节分录 |
| 资产负债表对账弹窗（`BalanceSheetTable.tsx`） | **简化**，提交后直接生成分录，不再跳转待处理页 |
| 台账页分录类型标签 `reconciliation → '对账调节'` | **保留** |

## 5. 插件 CONFIG_SCHEMA 变更

### 5.1 东方财富插件

新增字段：

```python
{
    "key": "adjust_account_id",
    "label": "调账科目",
    "type": "account_select",
    "required": False,
    "depends_on": "target_book",
    "description": "余额差异自动调账的目标科目（如投资收益），不设则使用系统默认科目（其他收入/其他费用）",
}
```

### 5.2 长桥证券插件

同上，新增 `adjust_account_id` 字段。

### 5.3 微信银行监控插件

同上，新增 `adjust_account_id` 字段。推荐调账科目为「其他收入」/「其他费用」，用户后续补记漏记交易时可冲销该调节分录。

## 6. 前端变更

### 6.1 Dashboard 变更

移除"待处理对账"入口：

```
变更前：
┌──────────────────────────────┐
│  📋 待处理对账           (3) │  ← 删除
└──────────────────────────────┘

变更后：
（无此入口）
```

### 6.2 科目详情页对账区域

行为简化：

```
变更前：
1. 用户输入真实余额 → 2. 提交快照 → 3. 跳转待处理页确认科目

变更后：
1. 用户输入真实余额 → 2. 提交快照 → 3. 自动生成调节分录（Toast 提示结果）
```

提交后的 Toast 提示：
- 差异为 0：「余额一致，无需调节」
- 差异不为 0：「已生成调节分录：{差异金额}」

### 6.3 资产负债表对账弹窗

同科目详情页，提交后直接显示结果，不再跳转。

### 6.4 插件配置表单

证券类插件配置表单中，多账本分组卡片内新增"调账科目"选择器：

```
┌──────────────────────────────────────────┐
│  📖 个人账本                     [✕]     │
│                                          │
│  证券资产科目 *                           │
│  ┌──────────────────────────────────┐    │
│  │ 长桥证券 (1101-01)          ▾    │    │
│  └──────────────────────────────────┘    │
│                                          │
│  调账科目                                │  ← 新增
│  ┌──────────────────────────────────┐    │
│  │ 投资收益                    ▾    │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

## 7. API 变更

### 7.1 `POST /accounts/{account_id}/snapshot` — 逻辑变更

**新增可选参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `adjust_account_id` | string (UUID) | ❌ | 调账科目 ID。传入时使用该科目生成调节分录；不传则使用系统默认科目（其他收入/其他费用） |

**处理流程变更：**

1. 计算账面余额（不变）
2. 计算差异（不变）
3. 创建 `BalanceSnapshot` 记录
4. **新逻辑**：
   - 差异 >= 0.01：
     - 确定调账科目：`adjust_account_id` 有值则使用，否则回退系统默认科目（差异 > 0 用"其他收入" `4009`，差异 < 0 用"其他费用" `5099`）
     - 生成已确认的调节分录（`entry_type = "reconciliation"`）
     - 快照 `status` = `"reconciled"`
   - 差异 < 0.01：
     - 快照 `status` = `"balanced"`

**响应不变**，仍返回快照信息。

### 7.2 删除的 API

见第 3.1 节。

## 8. 数据模型变更

### 8.1 `BalanceSnapshot.status` 枚举调整

| 变更前 | 变更后 | 说明 |
|--------|--------|------|
| `balanced` | `balanced` | 无差异 |
| `pending` | `reconciled` | 有差异且已调账（已生成调节分录） |
| `reconciled` | `reconciled` | 已调账 |

> `unreconciled` 状态不再需要——余额快照有差异时一定会生成调账分录（使用配置的调账科目或系统默认科目）。

### 8.2 `JournalEntry` 清理

| 字段 | 处理 |
|------|------|
| `reconciliation_status` | **删除**。历史数据中该字段不再使用 |
| `entry_type = "reconciliation"` | **保留**。对账调节分录仍使用此类型标识 |
| `source = "reconciliation"` | **保留** |

## 9. 涉及文件变更

### 9.1 后端删除

| 文件 | 操作 |
|------|------|
| 路由 `sync.py` 中 `pending-reconciliations`、`pending-count`、`confirm`、`split` 端点 | 删除 |
| `reconciliation_service.py` 中 `get_pending_reconciliations`、`get_pending_count`、`confirm_reconciliation`、`split_reconciliation` | 删除 |

### 9.2 后端修改

| 文件 | 变更 |
|------|------|
| `reconciliation_service.py` 中 `create_snapshot` | 简化：不再生成 pending 分录，改为根据 `adjust_account_id` 直接生成已确认分录 |
| `models/journal.py` | 移除 `reconciliation_status` 字段和相关索引 |
| `models/sync.py` | `BalanceSnapshot.status` 枚举简化为 `balanced/reconciled`（移除 `pending`） |
| `schemas/sync.py` | 请求/响应模型更新 |

### 9.3 数据迁移（Alembic migration）

需编写一个一次性数据迁移脚本，在 `alembic/versions/` 中新增一个 migration 文件，`upgrade()` 中依次执行：

| 步骤 | SQL | 说明 |
|------|-----|------|
| 1 | `UPDATE journal_entries SET reconciliation_status = 'confirmed' WHERE reconciliation_status = 'pending'` | 将所有 pending 调节分录改为 confirmed（直接生效） |
| 2 | `UPDATE balance_snapshots SET status = 'reconciled' WHERE status = 'pending'` | 关联快照从 pending 改为 reconciled |
| 3 | 移除 `journal_entries.reconciliation_status` 列 | 该字段不再使用 |
| 4 | 删除索引 `ix_journal_entries_book_reconciliation` | 关联索引一并清理 |
| 5 | 修改 `balance_snapshots.status` 枚举 | 从 `balanced/pending/reconciled` 缩减为 `balanced/reconciled` |

`downgrade()` 中做反向操作（恢复字段、索引、枚举）。

> **注意**：步骤 1-2 必须在步骤 3（删列）之前执行，否则数据丢失。

### 9.4 前端删除

| 文件 | 操作 |
|------|------|
| `client/app/sync/reconcile.tsx` | 删除 |
| `client/features/sync/ReconcileCard.tsx` | 删除 |
| `client/features/sync/BalanceCompare.tsx` | 删除 |
| `client/features/sync/index.ts` | 删除 |
| `client/services/syncService.ts` 中 pending 相关方法 | 删除 |

### 9.5 前端修改

| 文件 | 变更 |
|------|------|
| `client/app/(tabs)/index.tsx` | 移除"待处理对账"角标和跳转 |
| `client/app/_layout.tsx` | 移除 `sync/reconcile` 路由注册 |
| `client/app/accounts/[id].tsx` | 对账区域简化：提交后 Toast 提示，不跳转 |
| `client/features/account/AccountsPane.tsx` | 同上 |
| `client/features/report/BalanceSheetTable.tsx` | 对账弹窗简化：提交后 Toast 提示，不跳转 |
| `client/services/syncService.ts` | `submitSnapshot` 新增可选参数 `adjust_account_id` |

### 9.6 插件端修改

| 文件 | 变更 |
|------|------|
| `plugins/eastmoney_monitor/plugin.py` | CONFIG_SCHEMA 新增 `adjust_account_id`；同步时传入调账科目 |
| `plugins/longport_monitor/plugin.py` | 同上 |
| `plugins/wx_bank_monitor/plugin.py` | CONFIG_SCHEMA 新增 `adjust_account_id`；同步时传入调账科目 |

## 10. 验收标准

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| RC-1 | 待处理对账删除 | Dashboard 无"待处理对账"入口，`/sync/reconcile` 路由不存在 |
| RC-2 | 后端 API 清理 | `pending-reconciliations`、`pending-count`、`confirm`、`split` 四个端点返回 404 |
| RC-3 | 插件调账科目配置 | 所有余额同步插件（东财/长桥/微信银行）配置表单中均显示"调账科目"选择器（多账本下每个分组独立） |
| RC-4 | 插件自动调账 | 所有插件同步余额时，差异自动生成已确认的调节分录到配置的调账科目 |
| RC-5 | 无调账科目时回退默认 | 插件未配置调账科目时，使用系统默认科目（其他收入/其他费用）生成调节分录 |
| RC-6 | 用户手动对账 | 科目详情页输入真实余额后直接生成调节分录，Toast 提示结果 |
| RC-7 | 资产负债表对账 | 资产负债表中对账提交后直接生成分录，不跳转 |
| RC-8 | 分录类型标识 | 自动/手动生成的调节分录 `entry_type` 均为 `"reconciliation"`，台账页正确显示"对账调节" |
| RC-9 | 快照状态正确 | `balanced`（无差异）/ `reconciled`（已调账）两种状态正确 |
| RC-10 | 数据迁移 | Alembic migration 执行后：历史 pending 分录变为 confirmed，关联快照变为 reconciled，`reconciliation_status` 列已移除 |

## 11. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| 历史 pending 分录 | 已有待处理调节分录失去处理入口 | 数据迁移：将所有 `pending` 分录改为 `confirmed`（直接生效），关联快照改为 `reconciled` |
| 默认调账科目不存在 | 用户手动对账使用的默认科目可能不存在 | 后端回退：查找 `4009`/`5099`，不存在则用"其他收入"/"其他费用"的上级科目 |
| 用户依赖原有流程 | 极少数用户可能习惯了 pending → confirm 流程 | 属于边缘场景，新流程更简单，无需迁移引导 |

## 12. 不包含的内容（留待后续）

- 调节分录的批量查看/筛选（按来源、按科目）
- 自定义手动对账的默认调账科目（当前硬编码）
