# 家庭记账 - 产品需求文档 (PRD)

> **版本：v0.2.0**
> **创建日期：2026-02-13**
> **基于版本：v0.1.1**
> **状态：规划中**
> **本版本变更：插件化外部数据同步（API Key 认证、批量记账 API、余额同步 API、插件管理、前端 API Key & 插件管理 UI）**

---

## 1. 版本概述

### 1.1 版本目标

v0.2.0 引入**插件化外部数据同步架构**，Server 端暴露标准化 API 接口，外部独立插件（银行爬虫、微信账单解析器、券商同步脚本等）通过 API Key 认证调用这些接口，实现自动记账和余额同步。

| 能力 | 核心价值 |
|------|---------|
| API Key 认证 | 独立于用户 Token 的长期有效密钥，适合无人值守的定时脚本/插件调用 |
| 批量记账 API | 插件一次性提交多条分录，支持去重（`external_id`），全量事务回滚 |
| 余额同步 API | 插件提交资产/负债科目的真实余额，Server 自动计算差额并生成调节分录 |
| 插件管理 | 插件注册、状态上报、最后同步时间追踪 |
| 前端 API Key 管理 | 用户在「我的」页面创建/查看/停用/删除 API Key，创建时一次性展示明文 |
| 前端插件管理 | 用户在「我的」页面查看插件状态、同步记录、删除插件 |

### 1.2 架构理念

**Server 只做数据 CRUD，不集成任何银行/券商的爬取逻辑。** 不同银行、券商、支付平台的数据获取方式差异极大，将这些逻辑放到独立的插件中，各插件可以用任何语言编写、运行在任何地方（本地 cron、Docker 容器、云函数等），只要能连接到 Server API 即可。

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ 招行爬虫插件  │  │ 微信账单插件  │  │ 券商同步插件  │
│ (Python)     │  │ (Node.js)   │  │ (Go)        │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       │    API Key 认证 + HTTPS           │
       ▼                 ▼                 ▼
┌─────────────────────────────────────────────────┐
│                    Server API                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────┐│
│  │ 批量记账 API  │  │ 余额同步 API │  │插件管理 ││
│  └──────────────┘  └──────────────┘  └────────┘│
└─────────────────────────────────────────────────┘
```

### 1.3 两类插件

| 类型 | 用途 | 调用的 API | 典型场景 |
|------|------|-----------|---------|
| **记账插件** | 爬取银行/微信/支付宝的交易流水，批量导入为分录 | 批量记账 API | 招行交易流水导入、微信账单导入、支付宝账单导入 |
| **同步插件** | 获取账户当前余额/市值，更新系统中对应科目的余额 | 余额同步 API | 银行卡余额同步、股票/基金账户市值同步、信用卡待还金额同步 |

> 一个插件可以同时具备两种能力（如招行插件：既导入流水又同步余额）。

### 1.4 与现有系统的关系

- **复用现有 `EntryCreateRequest` schema**：批量记账 API 的每条记录格式与现有创建分录 API 一致
- **复用现有对账逻辑**：余额同步 API 复用 v0.0.1 的 `reconciliation_service`（差额计算 + 调节分录生成）
- **新增 `external_id` 字段**：`journal_entries` 表新增外部唯一标识，用于幂等去重
- **新增 `api_keys` 表**：API Key 管理
- **新增 `plugins` 表**：插件注册与状态管理

### 1.5 不包含的内容（留待后续版本）

- 智能流水分类（AI 建议科目映射）
- 家庭账本 & 多人协作
- 数据导出（CSV/Excel/PDF）

### 1.6 设计约束

- **事务性**：批量记账 API 要么全部成功，要么全部回滚
- **幂等性**：通过 `external_id` 去重，重复提交不会产生重复分录
- **科目校验**：插件传入的科目 ID 必须存在且有效，否则返回错误
- **借贷平衡**：每条分录仍需通过借贷平衡校验
- **API Key 安全**：Key 以哈希形式存储，仅在创建时返回明文一次

---

## 2. 功能需求：API Key 管理

### 2.1 功能概述

用户可以创建多个 API Key，每个 Key 绑定到一个用户，调用时通过参数指定目标 `book_id`。支持为不同插件创建不同的 Key，方便单独吊销。

### 2.2 API Key 属性

| 字段 | 说明 |
|------|------|
| `name` | Key 名称（如"招行插件"、"微信账单"） |
| `key_prefix` | Key 前缀（前 8 位明文，用于识别） |
| `key_hash` | Key 的哈希值（bcrypt），存储后无法还原明文 |
| `user_id` | 所属用户 |
| `is_active` | 是否启用（支持临时停用） |
| `last_used_at` | 最后使用时间 |
| `expires_at` | 过期时间（NULL 表示永不过期） |
| `created_at` | 创建时间 |

### 2.3 API Key 生命周期

1. **创建**：用户调用创建 API → 系统生成随机 Key（如 `hak_xxxxxxxxxxxx`，前缀 `hak_` 表示 Home Accountant Key）→ 返回明文 Key（**仅此一次**）→ 存储哈希
2. **使用**：插件在请求 Header 中携带 `Authorization: Bearer hak_xxxxxxxxxxxx` → Server 校验哈希 → 鉴权通过
3. **停用**：将 `is_active` 设为 `false`，该 Key 立即失效
4. **删除**：永久删除 Key 记录
5. **列表**：展示所有 Key 的名称、前缀、创建时间、最后使用时间、状态

### 2.4 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api-keys` | 创建 API Key（需用户 Token 认证） |
| `GET` | `/api-keys` | 列出当前用户的所有 API Key |
| `DELETE` | `/api-keys/{key_id}` | 删除 API Key |
| `PATCH` | `/api-keys/{key_id}` | 更新 Key 状态（启用/停用） |

### 2.5 认证方式

插件调用 API 时，通过 HTTP Header 携带 API Key：

```
Authorization: Bearer hak_a1b2c3d4e5f6g7h8i9j0...
```

Server 端新增 `get_current_user_by_api_key` 依赖注入，与现有的 JWT `get_current_user` 并行：

```python
async def get_api_user(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> User:
    """从 API Key 解析用户"""
    # 1. 提取 Bearer token
    # 2. 遍历 api_keys 表，bcrypt.verify(token, key_hash)
    # 3. 校验 is_active、expires_at
    # 4. 更新 last_used_at
    # 5. 返回关联的 User
```

> **性能优化**：由于需要遍历所有 Key 做 bcrypt 验证（O(n)），可用 `key_prefix`（前 8 位明文索引）先缩小范围，再做 bcrypt 比对。

---

## 3. 功能需求：插件管理

### 3.1 功能概述

插件是一个逻辑实体，代表一个外部数据同步程序。每个插件关联一个 API Key，记录插件的类型、同步状态、最后同步时间等信息。

### 3.2 插件属性

| 字段 | 说明 |
|------|------|
| `id` | 插件 ID |
| `name` | 插件名称（如"招行储蓄卡同步"） |
| `type` | 插件类型：`entry`（记账插件）/ `balance`（同步插件）/ `both`（两者兼备） |
| `api_key_id` | 关联的 API Key |
| `user_id` | 所属用户 |
| `description` | 插件描述 |
| `last_sync_at` | 最后同步时间 |
| `last_sync_status` | 最后同步状态：`success` / `failed` / `running` |
| `last_error_message` | 最后一次失败的错误信息 |
| `sync_count` | 累计同步次数 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 3.3 插件去重 & 幂等注册

同一用户下，`name` 字段唯一（联合唯一约束 `user_id + name`）。注册 API 采用**幂等语义**：

| 场景 | 行为 | HTTP 状态码 |
|------|------|------------|
| `name` 不存在 | 创建新插件 | `201 Created` |
| `name` 已存在 | 返回已有插件记录（同时更新 `api_key_id`、`type`、`description`） | `200 OK` |

> 这样插件脚本可以在每次启动时安全调用 `POST /plugins` 而无需担心重复注册。如果插件换了 API Key，重新注册会自动换绑。

### 3.4 插件生命周期

1. **注册**：插件首次运行时，调用注册 API 创建插件记录（幂等，重复调用不会创建重复记录）
2. **心跳/状态上报**：每次同步开始时上报 `running`，完成时上报 `success` 或 `failed`
3. **查询**：用户可查看所有插件的状态、最后同步时间
4. **删除**：删除插件记录（不影响已导入的分录数据）

### 3.5 API 端点

| 方法 | 路径 | 认证方式 | 说明 |
|------|------|---------|------|
| `POST` | `/plugins` | API Key | 注册插件 |
| `GET` | `/plugins` | API Key / Token | 列出插件 |
| `GET` | `/plugins/{plugin_id}` | API Key / Token | 插件详情 |
| `PUT` | `/plugins/{plugin_id}/status` | API Key | 上报同步状态 |
| `DELETE` | `/plugins/{plugin_id}` | Token | 删除插件 |

---

## 4. 功能需求：批量记账 API

### 4.1 功能概述

插件将爬取到的交易流水通过批量记账 API 一次性提交多条分录。支持 `external_id` 去重，整个批次在一个数据库事务中执行，任意一条失败则全部回滚。

### 4.2 `external_id` 去重机制

`journal_entries` 表新增 `external_id` 字段（可选，VARCHAR，唯一索引）：

- **插件端负责生成**：推荐使用 `日期 + 时间 + 金额 + 来源` 的哈希值，或直接使用银行交易流水号
- **Server 端去重逻辑**：
  - 提交时如果 `external_id` 已存在 → 跳过该条（不报错，视为已导入）
  - 返回结果中标注每条记录的状态：`created`（新建）/ `skipped`（跳过）

### 4.3 请求格式

```
POST /plugins/{plugin_id}/entries/batch
Authorization: Bearer hak_xxxxxxxxxxxx
Content-Type: application/json
```

```json
{
  "book_id": "uuid-of-book",
  "entries": [
    {
      "external_id": "sha256_of_transaction_1",
      "entry_type": "expense",
      "entry_date": "2026-02-13",
      "description": "星巴克咖啡",
      "amount": 38.00,
      "category_account_id": "uuid-of-dining-account",
      "payment_account_id": "uuid-of-bank-account",
      "note": "招行流水自动导入"
    },
    {
      "external_id": "sha256_of_transaction_2",
      "entry_type": "income",
      "entry_date": "2026-02-12",
      "description": "工资",
      "amount": 15000.00,
      "category_account_id": "uuid-of-salary-account",
      "payment_account_id": "uuid-of-bank-account"
    }
  ]
}
```

> 每条 entry 的格式与现有 `EntryCreateRequest` 一致（复用同一 schema），额外增加 `external_id` 字段。

### 4.4 响应格式

```json
{
  "total": 2,
  "created": 1,
  "skipped": 1,
  "results": [
    {
      "index": 0,
      "external_id": "sha256_of_transaction_1",
      "status": "created",
      "entry_id": "uuid-of-new-entry"
    },
    {
      "index": 1,
      "external_id": "sha256_of_transaction_2",
      "status": "skipped",
      "entry_id": "uuid-of-existing-entry"
    }
  ]
}
```

### 4.5 错误处理

| 场景 | 行为 |
|------|------|
| 某条分录的科目 ID 不存在 | **整个批次回滚**，返回 400 + 错误详情（标注是第几条出错） |
| 某条分录借贷不平衡 | **整个批次回滚** |
| `external_id` 已存在 | 该条标记为 `skipped`，**不影响其他条** |
| API Key 无效/过期 | 401 Unauthorized |
| `book_id` 不属于该用户 | 403 Forbidden |
| 请求体格式错误 | 422 Validation Error |

### 4.6 `source` 字段

通过批量记账 API 创建的分录，`source` 字段设为 `sync`（区别于手动创建的 `manual`）。

### 4.7 限制

| 限制项 | 值 | 说明 |
|-------|---|------|
| 单次批量最大条数 | 200 | 超过返回 400 |
| `external_id` 最大长度 | 128 | SHA-256 哈希 64 字符足够 |

---

## 5. 功能需求：余额同步 API

### 5.1 功能概述

插件获取银行卡/股票账户/信用卡的当前真实余额后，提交到余额同步 API。Server 端自动计算差额（外部余额 - 账本余额），差额不为零时自动生成调节分录。

### 5.2 核心流程

复用 v0.0.1 的对账逻辑（`reconciliation_service`），流程如下：

```
插件提交：account_id + balance + date
            │
            ▼
  Server 计算账本余额（该科目截至 date 的借贷汇总）
            │
            ▼
  差额 = 外部余额 - 账本余额
            │
   ┌────────┼────────┐
   │        │        │
差额=0   差额≠0   差额≠0
(已平衡)  (资产类)  (负债类)
   │        │        │
   ✅    生成调节    生成调节
        分录        分录
```

### 5.3 调节分录生成规则

复用 v0.0.1 PRD §2.2.6 的规则：

| 科目类型 | 差异方向 | 默认调节分录 | 调节分录状态 |
|---------|---------|-------------|------------|
| 资产（银行存款等） | 余额减少 | 借：待分类费用 / 贷：该资产科目 | `confirmed`（自动确认） |
| 资产（银行存款等） | 余额增加 | 借：该资产科目 / 贷：待分类收入 | `confirmed`（自动确认） |
| 资产（投资类） | 市值变动 | 借/贷：投资账户 / 贷/借：投资收益 | `confirmed`（自动确认） |
| 负债（信用卡等） | 负债增加 | 借：待分类费用 / 贷：该负债科目 | `confirmed`（自动确认） |
| 负债（信用卡等） | 负债减少 | 借：该负债科目 / 贷：待分类收入 | `confirmed`（自动确认） |

> 所有调节分录默认自动确认，无需用户手动操作。

### 5.4 请求格式

```
POST /plugins/{plugin_id}/balance/sync
Authorization: Bearer hak_xxxxxxxxxxxx
Content-Type: application/json
```

```json
{
  "book_id": "uuid-of-book",
  "snapshots": [
    {
      "account_id": "uuid-of-cmb-savings",
      "balance": 85320.50,
      "snapshot_date": "2026-02-13"
    },
    {
      "account_id": "uuid-of-stock-account",
      "balance": 53000.00,
      "snapshot_date": "2026-02-13"
    }
  ]
}
```

> 支持一次提交多个科目的余额快照。

### 5.5 响应格式

```json
{
  "total": 2,
  "results": [
    {
      "account_id": "uuid-of-cmb-savings",
      "account_name": "招商银行储蓄卡",
      "book_balance": 86000.00,
      "external_balance": 85320.50,
      "difference": -679.50,
      "status": "reconciliation_created",
      "reconciliation_entry_id": "uuid-of-adjustment-entry",
      "snapshot_id": "uuid-of-snapshot"
    },
    {
      "account_id": "uuid-of-stock-account",
      "account_name": "股票账户",
      "book_balance": 53000.00,
      "external_balance": 53000.00,
      "difference": 0,
      "status": "balanced",
      "reconciliation_entry_id": null,
      "snapshot_id": "uuid-of-snapshot"
    }
  ]
}
```

### 5.6 与现有手动对账的关系

余额同步 API 的底层逻辑与现有 `POST /accounts/{id}/snapshot`（手动对账）完全一致。区别在于：

| 维度 | 手动对账 | 插件同步 |
|------|---------|---------|
| 触发方式 | 用户在客户端手动输入 | 插件自动提交 |
| 认证方式 | JWT Token | API Key |
| 单次提交 | 单个科目 | 支持批量多个科目 |
| 来源标记 | `source: manual` | `source: sync` |

---

## 6. 数据模型变更

### 6.1 `journal_entries` 表 — 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `external_id` | VARCHAR(128), NULLABLE, UNIQUE | 外部唯一标识，用于幂等去重。手动创建的分录为 NULL |

> 唯一索引范围为同一 `book_id` 内唯一（联合唯一索引 `book_id` + `external_id`），不同账本可以有相同的 `external_id`。

### 6.2 新增 `api_keys` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID (FK → users) | 所属用户 |
| `name` | VARCHAR(100) | Key 名称 |
| `key_prefix` | VARCHAR(12) | Key 前缀（明文，用于识别和快速查找） |
| `key_hash` | VARCHAR(128) | Key 哈希值（bcrypt） |
| `is_active` | BOOLEAN | 是否启用，默认 true |
| `last_used_at` | TIMESTAMP | 最后使用时间 |
| `expires_at` | TIMESTAMP | 过期时间，NULL 表示永不过期 |
| `created_at` | TIMESTAMP | 创建时间 |

### 6.3 新增 `plugins` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID (FK → users) | 所属用户 |
| `api_key_id` | UUID (FK → api_keys) | 关联的 API Key |
| `name` | VARCHAR(100) | 插件名称（同一用户下唯一） |
| `type` | ENUM | `entry` / `balance` / `both` |
| `description` | TEXT | 插件描述 |
| `last_sync_at` | TIMESTAMP | 最后同步时间 |
| `last_sync_status` | ENUM | `idle` / `running` / `success` / `failed` |
| `last_error_message` | TEXT | 最后一次失败的错误信息 |
| `sync_count` | INT | 累计同步次数，默认 0 |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

---

## 7. API 总览

### 7.1 API Key 管理（用户 Token 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api-keys` | 创建 API Key |
| `GET` | `/api-keys` | 列出用户的所有 Key |
| `PATCH` | `/api-keys/{key_id}` | 更新 Key 状态 |
| `DELETE` | `/api-keys/{key_id}` | 删除 Key |

### 7.2 插件管理（API Key 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/plugins` | 注册插件 |
| `GET` | `/plugins` | 列出插件 |
| `GET` | `/plugins/{plugin_id}` | 插件详情 |
| `PUT` | `/plugins/{plugin_id}/status` | 上报同步状态 |
| `DELETE` | `/plugins/{plugin_id}` | 删除插件（Token 认证） |

### 7.3 记账插件 API（API Key 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/plugins/{plugin_id}/entries/batch` | 批量创建分录 |

### 7.4 同步插件 API（API Key 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/plugins/{plugin_id}/balance/sync` | 批量余额同步 |

---

## 8. 功能需求：前端 — API Key 管理

### 8.1 入口

在「我的」页面菜单中新增「API Key 管理」菜单项（icon: `key`），位于「科目管理」下方。

- **移动端**：点击后 `router.push('/settings/api-keys')` 进入独立页面
- **桌面端**：点击后 `setActiveDetail('api-keys')` 在右侧面板中展示

### 8.2 API Key 列表视图

```
┌──────────────────────────────────────────────────────┐
│  API Key 管理                           [+ 创建 Key] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔑 生产环境主 Key                              │  │
│  │  hak_a1b2c3d4...    创建于 2026-02-01          │  │
│  │  最后使用：2026-02-13 14:30                     │  │
│  │  关联插件：3 个                                  │  │
│  │  状态：● 启用                [停用]  [删除]     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔑 测试用 Key                                  │  │
│  │  hak_x9y8z7w6...    创建于 2026-02-10          │  │
│  │  最后使用：从未使用                              │  │
│  │  关联插件：0 个                                  │  │
│  │  状态：● 启用                [停用]  [删除]     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  （空状态：暂无 API Key，点击右上角创建）             │
└──────────────────────────────────────────────────────┘
```

> **注意**：API Key 的名称是用户自定义的标识（如"生产环境主 Key"、"测试用 Key"），与插件名称无关。一个 Key 可被多个插件共用，也可以创建多个 Key 分别给不同插件使用。

### 8.3 创建 API Key 流程

1. 点击「创建 Key」按钮 → 弹出 Modal
2. 输入 Key 名称（必填，如"生产环境主 Key"、"本地测试"）
3. 选择过期时间（可选：永不过期 / 30天 / 90天 / 1年）
4. 点击「创建」→ 调用 `POST /api-keys`
5. **创建成功后展示明文 Key（仅此一次）**：
   - Modal 中展示完整 Key，带「复制」按钮
   - 醒目提示：「请立即复制保存，关闭后无法再次查看」
   - 点击「复制」→ 写入剪贴板 → Toast 提示"已复制"
   - 点击「我已保存，关闭」→ 关闭 Modal，刷新列表

```
┌──────────────────────────────────────────────────┐
│  ✅ API Key 创建成功                              │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ hak_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7... │ │
│  └─────────────────────────────────────────────┘ │
│                          [📋 复制]                │
│                                                   │
│  ⚠️ 请立即复制保存此 Key，关闭后无法再次查看！     │
│                                                   │
│              [我已保存，关闭]                       │
└──────────────────────────────────────────────────┘
```

### 8.4 操作

| 操作 | 说明 |
|------|------|
| 停用/启用 | 切换 `is_active` 状态，调用 `PATCH /api-keys/{id}`。停用后卡片变灰，按钮切换为「启用」 |
| 删除 | 弹出确认 Modal（「删除后关联的插件将一并删除，是否继续？」），确认后调用 `DELETE /api-keys/{id}` |

### 8.5 前端文件

| 文件 | 说明 |
|------|------|
| `client/services/apiKeyService.ts` | API Key CRUD 请求封装 |
| `client/app/settings/api-keys.tsx` | 移动端 API Key 管理页面 |
| `profile.tsx` 中 `ApiKeysPane` 组件 | 桌面端右侧面板（内联） |

---

## 9. 功能需求：前端 — 插件管理

### 9.1 入口

在「我的」页面菜单中新增「插件管理」菜单项（icon: `plug`），位于「API Key 管理」下方。

- **移动端**：点击后 `router.push('/settings/plugins')` 进入独立页面
- **桌面端**：点击后 `setActiveDetail('plugins')` 在右侧面板中展示

### 9.2 插件列表视图

```
┌──────────────────────────────────────────────────────┐
│  插件管理                                             │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔌 招行储蓄卡同步                   [记账+同步] │  │
│  │  关联 Key：hak_a1b2c3d4...                     │  │
│  │  最后同步：2026-02-13 14:30   ● 成功            │  │
│  │  累计同步：23 次                                 │  │
│  │                                      [删除]     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔌 股票账户同步                       [同步]    │  │
│  │  关联 Key：hak_x9y8z7w6...                     │  │
│  │  最后同步：2026-02-12 09:00   ● 失败            │  │
│  │  错误：连接超时                                  │  │
│  │  累计同步：15 次                                 │  │
│  │                                      [删除]     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  （空状态：暂无插件，插件会在首次调用 API 时自动注册） │
└──────────────────────────────────────────────────────┘
```

### 9.3 插件卡片信息

| 字段 | 展示方式 |
|------|---------|
| 插件名称 | 标题，左对齐 |
| 插件类型 | 标签：`记账` / `同步` / `记账+同步`（对应 `entry` / `balance` / `both`） |
| 关联 Key | 显示 Key 前缀（`key_prefix`） |
| 最后同步时间 | 相对时间（如"5分钟前"）或绝对时间 |
| 同步状态 | 状态指示灯：🟢 成功 / 🔴 失败 / 🔵 运行中 / ⚪ 未同步 |
| 错误信息 | 仅在 `failed` 状态时展示，红色文字 |
| 累计同步次数 | 数字 |

### 9.4 操作

| 操作 | 说明 |
|------|------|
| 删除 | 弹出确认 Modal（「删除插件记录？已导入的分录数据不受影响」），确认后调用 `DELETE /plugins/{id}` |

> 插件由外部脚本通过 API 自动注册，前端不提供「创建插件」功能，仅做查看和删除。

### 9.5 前端文件

| 文件 | 说明 |
|------|------|
| `client/services/pluginService.ts` | 插件查询/删除请求封装 |
| `client/app/settings/plugins.tsx` | 移动端插件管理页面 |
| `profile.tsx` 中 `PluginsPane` 组件 | 桌面端右侧面板（内联） |

---

## 10. 功能需求：前端 — 「我的」页面菜单更新

### 10.1 菜单结构变更

当前菜单：

```
[编辑个人信息] [科目管理] [外部账户(即将推出)] [固定资产] [贷款管理] [预算设置] [数据导入/导出(即将推出)]
---
[设置] [关于]
---
[退出登录]
```

v0.2.0 更新后：

```
[编辑个人信息] [科目管理] [API Key 管理(🆕)] [插件管理(🆕)] [外部账户(即将推出)] [固定资产] [贷款管理] [预算设置] [数据导入/导出(即将推出)]
---
[设置] [关于]
---
[退出登录]
```

### 10.2 `DetailPane` 类型扩展

```typescript
type DetailPane = 'none' | 'edit-profile' | 'settings' | 'accounts'
  | 'assets' | 'loans' | 'budget'
  | 'api-keys'   // 🆕
  | 'plugins';   // 🆕
```

---

## 11. 版本规划更新

### v0.0.1 (MVP) — 已完成 ✅
- [x] 邮箱注册/登录
- [x] 科目体系
- [x] 快捷记账（6种类型）
- [x] 分录列表（账本）
- [x] 资产负债表 & 损益表
- [x] 总览仪表盘
- [x] 手动对账 & 待处理队列
- [x] 三端适配 & 深色模式

### v0.0.2 — 已完成 ✅
- [x] 固定资产折旧管理（自动折旧分录、资产处置）
- [x] 贷款管理 & 还款计划（还款计划表、本金/利息自动拆分、提前还款）
- [x] 预算管理 & 提醒（总预算/分类预算、超支提醒、Dashboard 联动）

### v0.0.3 — 已完成 ✅
- [x] 总览页桌面端布局重构（左右分栏，近期分录移至右侧面板）
- [x] 移动端 Dashboard 移除近期分录区块

### v0.1.1 — 已完成 ✅
- [x] 分录完整编辑（科目、金额、所有业务字段）
- [x] 复用 `entry/new.tsx` 作为编辑页面（预填数据，编辑模式）
- [x] 后端 `PUT /entries/{id}` 扩展为支持全部业务字段
- [x] 详情页改为纯只读，编辑跳转到编辑页面

### v0.2.0 — 本版本 已完成 ✅
- [ ] API Key 管理（创建、列出、停用、删除）
- [ ] 插件管理（注册、状态上报、查询）
- [ ] `journal_entries` 新增 `external_id` 字段（幂等去重）
- [ ] 批量记账 API（事务性、去重、复用 `EntryCreateRequest`）
- [ ] 余额同步 API（自动差额计算、生成调节分录）
- [ ] API Key 认证中间件（与 JWT 并行）
- [ ] 前端：API Key 管理页面（创建 Key、复制明文、停用/删除）
- [ ] 前端：插件管理页面（查看插件状态、同步记录、删除）
- [ ] 前端：「我的」页面菜单新增 API Key 管理 & 插件管理入口

### v0.2.1
- [ ] MCP（Model Context Protocol）接口层，将 v0.2.0 的插件 API 封装为 MCP Tools，支持 AI Agent 直接调用：
  - [ ] 记账工具：AI 通过自然语言解析后调用批量记账接口
  - [ ] 余额同步工具：AI 驱动的银行余额查询与同步
  - [ ] 账目查询工具：AI 可查询分录、科目余额、资产负债表等
  - [ ] 插件管理工具：AI 可查看插件状态、触发同步等
- [ ] 分录类型转换（费用 ↔ 资产购置等）

### （远期）
- [ ] 家庭账本 & 多人协作
- [ ] CSV 账单导入 & 流水匹配对账
- [ ] 高级模式（手动分录）
- [ ] 数据导出（CSV/Excel/PDF）
- [ ] 离线记账 + 本地 SQLite 缓存
