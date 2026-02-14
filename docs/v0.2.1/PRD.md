# 家庭记账 - 产品需求文档 (PRD)

> **版本：v0.2.1**
> **创建日期：2026-02-14**
> **基于版本：v0.2.0**
> **状态：规划中**
> **本版本变更：MCP（Model Context Protocol）接口层 + 前端 MCP 服务入口 + 分录类型转换**

---

## 1. 版本概述

### 1.1 版本目标

v0.2.1 引入 **MCP 接口层**，将 v0.2.0 已有的后端 API 封装为 MCP Tools，使 AI Agent（Claude Desktop、Cursor、自定义 Agent 等）能够直接调用家庭记账系统的能力。同时新增**分录类型转换**功能，允许用户在不删除重建的情况下将已有分录从一种类型转换为另一种类型。

| 能力 | 核心价值 |
|------|---------|
| MCP 接口层 | AI Agent 通过标准 MCP 协议直接调用记账、查询、同步等能力，无需编写 HTTP 请求代码 |
| 记账工具 | LLM 从用户自然语言中提取结构化参数，调用批量记账 Tool |
| 查询工具 | LLM 可查询分录、科目余额、资产负债表、损益表等 |
| 余额同步工具 | LLM 驱动余额同步流程 |
| 插件管理工具 | LLM 可查看插件状态 |
| 前端 MCP 服务入口 | 用户在「个人中心」查看 MCP 连接配置，一键复制 AI 工具配置 JSON |
| 分录类型转换 | 费用 ↔ 资产购置、收入 ↔ 负债偿还等互转 |

### 1.2 MCP 架构理念

**MCP Server 是 AI Agent 与家庭记账系统之间的桥梁。** 它不引入新的业务逻辑，而是将已有的 REST API 封装为 LLM 友好的 Tool 接口。

```
┌─────────────────────────────────────────────────────┐
│               AI Agent / LLM 应用                    │
│  （Claude Desktop、Cursor、自定义 Agent 等）          │
└──────────────────────┬──────────────────────────────┘
                       │ MCP 协议（stdio / SSE）
                       ▼
┌─────────────────────────────────────────────────────┐
│                  MCP Server                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ 记账工具  │ │ 查询工具  │ │ 同步工具  │ │管理工具│ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       │            │            │            │      │
│       └────────────┴────────────┴────────────┘      │
│                        │                             │
│                内部调用 REST API                      │
│                （HTTP / 直接 Service 调用）            │
└────────────────────────┬────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────┐
│              家庭记账 Server（FastAPI）               │
│   已有 REST API（v0.2.0 全部端点）                    │
└─────────────────────────────────────────────────────┘
```

### 1.3 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| MCP SDK | `mcp` Python SDK（`FastMCP`） | 官方 SDK，自定义 Tool 定义更灵活，参数描述 LLM 友好 |
| 调用方式 | MCP Server 通过 HTTP 调用已有 REST API | 解耦 MCP 层与业务层，MCP Server 可独立部署 |
| 认证方式 | MCP Server 使用 API Key 认证 | 需将 MCP 依赖的端点从「仅 JWT」升级为「JWT + API Key」双模式认证 |
| 传输方式 | 同时支持 stdio 和 SSE | stdio 用于本地 Agent（Claude Desktop、Cursor），SSE 用于远程调用 |
| 自然语言解析 | 由 LLM 自身完成 | MCP Tool 只暴露结构化参数，LLM 负责从自然语言中提取参数填入 |

### 1.4 不包含的内容（留待后续版本）

- 智能流水分类（AI 自动建议科目映射）
- MCP Resources（将报表数据作为 MCP Resource 暴露，非 Tool 调用）
- MCP Prompts（预置 Prompt 模板）
- 家庭账本 & 多人协作
- 数据导出（CSV/Excel/PDF）

---

## 2. 功能需求：MCP 接口层

### 2.1 MCP Tools 总览

共设计 **10 个 MCP Tools**，按功能域分组：

| 分组 | Tool 名称 | 说明 | 对应 REST API |
|------|----------|------|--------------|
| **记账** | `create_entries` | 创建一条或多条分录 | `POST /plugins/{id}/entries/batch` |
| **记账** | `list_entries` | 查询分录列表（支持按日期、类型、科目筛选） | `GET /books/{id}/entries` |
| **记账** | `get_entry` | 获取单条分录详情 | `GET /entries/{id}` |
| **记账** | `delete_entry` | 删除分录 | `DELETE /entries/{id}` |
| **查询** | `get_balance_sheet` | 获取资产负债表 | `GET /books/{id}/balance-sheet` |
| **查询** | `get_income_statement` | 获取损益表 | `GET /books/{id}/income-statement` |
| **查询** | `get_dashboard` | 获取仪表盘概况（净资产、本月收支） | `GET /books/{id}/dashboard` |
| **同步** | `sync_balance` | 提交科目余额快照，自动差额计算 | `POST /plugins/{id}/balance/sync` |
| **管理** | `list_accounts` | 获取科目树 | `GET /books/{id}/accounts` |
| **管理** | `list_plugins` | 查看已注册插件列表及状态 | `GET /plugins` |

### 2.2 Tool 详细设计

#### 2.2.1 `create_entries` — 智能记账

**用途**：LLM 从用户自然语言中提取结构化数据，调用此 Tool 创建分录。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book_id` | string | 是 | 目标账本 ID |
| `entries` | array | 是 | 分录列表（1-200 条） |
| `entries[].entry_type` | string | 是 | 分录类型：`expense` / `income` / `transfer` / `asset_purchase` / `borrow` / `repay` |
| `entries[].entry_date` | string | 是 | 日期（YYYY-MM-DD） |
| `entries[].description` | string | 是 | 摘要 |
| `entries[].amount` | number | 是 | 金额 |
| `entries[].category_account_id` | string | 是 | 分类科目 ID（费用类/收入类科目） |
| `entries[].payment_account_id` | string | 是 | 支付科目 ID（资产类/负债类科目） |
| `entries[].external_id` | string | 否 | 去重标识（推荐填写） |
| `entries[].note` | string | 否 | 备注 |

**返回**：

```json
{
  "total": 2,
  "created": 1,
  "skipped": 1,
  "results": [
    { "index": 0, "status": "created", "entry_id": "uuid" },
    { "index": 1, "status": "skipped", "entry_id": "uuid-existing" }
  ]
}
```

**典型 LLM 交互场景**：

```
用户：今天买了杯星巴克38块，打车去公司花了15
LLM 思考：提取两笔费用 → 调用 create_entries
Tool 调用：create_entries(book_id="xxx", entries=[
  {entry_type: "expense", entry_date: "2026-02-14", description: "星巴克咖啡", amount: 38, category_account_id: "餐饮费ID", payment_account_id: "默认支付ID"},
  {entry_type: "expense", entry_date: "2026-02-14", description: "打车上班", amount: 15, category_account_id: "交通费ID", payment_account_id: "默认支付ID"}
])
```

> **注意**：LLM 需要先调用 `list_accounts` 获取科目 ID 映射，才能正确填入 `category_account_id` 和 `payment_account_id`。

#### 2.2.2 `list_entries` — 分录查询

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book_id` | string | 是 | 账本 ID |
| `start_date` | string | 否 | 开始日期（YYYY-MM-DD） |
| `end_date` | string | 否 | 结束日期（YYYY-MM-DD） |
| `entry_type` | string | 否 | 分录类型筛选 |
| `account_id` | string | 否 | 科目筛选 |
| `page` | integer | 否 | 页码，默认 1 |
| `page_size` | integer | 否 | 每页条数，默认 20 |

**返回**：分页的分录列表（含 ID、日期、摘要、金额、类型、科目名称）。

#### 2.2.3 `get_entry` — 分录详情

**参数**：`entry_id` (string, 必填)

**返回**：完整分录信息，含借贷明细行。

#### 2.2.4 `delete_entry` — 删除分录

**参数**：`entry_id` (string, 必填)

**返回**：`{ "success": true }`

#### 2.2.5 `get_balance_sheet` — 资产负债表

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book_id` | string | 是 | 账本 ID |
| `as_of_date` | string | 否 | 截止日期，默认今天 |

**返回**：资产/负债/净资产分组明细及合计。

#### 2.2.6 `get_income_statement` — 损益表

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book_id` | string | 是 | 账本 ID |
| `start_date` | string | 否 | 开始日期（默认本月1日） |
| `end_date` | string | 否 | 结束日期（默认今天） |

**返回**：收入/费用分类明细及损益合计。

#### 2.2.7 `get_dashboard` — 仪表盘概况

**参数**：`book_id` (string, 必填)

**返回**：净资产、本月收入、本月费用、本月损益、较上月变化百分比。

#### 2.2.8 `sync_balance` — 余额同步

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book_id` | string | 是 | 账本 ID |
| `snapshots` | array | 是 | 余额快照列表 |
| `snapshots[].account_id` | string | 是 | 科目 ID |
| `snapshots[].balance` | number | 是 | 外部真实余额 |
| `snapshots[].snapshot_date` | string | 是 | 快照日期（YYYY-MM-DD） |

**返回**：各科目的账本余额、外部余额、差额、是否生成调节分录。

#### 2.2.9 `list_accounts` — 科目树

**参数**：`book_id` (string, 必填)

**返回**：按类型分组的科目树结构，含 ID、名称、类型、余额方向、子科目。

> 此 Tool 是其他 Tool 的前置依赖 —— LLM 需要先获取科目树，才能知道 `category_account_id` 和 `payment_account_id` 应该填什么值。

#### 2.2.10 `list_plugins` — 插件列表

**参数**：无

**返回**：已注册插件列表（名称、类型、同步状态、最后同步时间、同步次数、错误信息）。

### 2.3 MCP Server 配置

MCP Server 通过环境变量或配置文件进行初始化：

| 配置项 | 环境变量 | 说明 | 默认值 |
|--------|---------|------|--------|
| Server 基础 URL | `HA_SERVER_URL` | 家庭记账 Server 的地址 | `http://localhost:8000` |
| 认证方式 | `HA_AUTH_TYPE` | `api_key` 或 `jwt_token` | `api_key` |
| API Key | `HA_API_KEY` | 当 `auth_type=api_key` 时使用 | — |
| JWT Token | `HA_JWT_TOKEN` | 当 `auth_type=jwt_token` 时使用 | — |
| 默认账本 ID | `HA_DEFAULT_BOOK_ID` | 省略 `book_id` 参数时的默认值 | — |
| 传输方式 | `HA_TRANSPORT` | `stdio` 或 `sse` | `stdio` |
| SSE 端口 | `HA_SSE_PORT` | SSE 模式下的监听端口 | `3000` |

### 2.4 MCP Server 启动方式

#### stdio 模式（本地 Agent）

```json
// Claude Desktop / Cursor MCP 配置
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "home_accountant_mcp"],
      "env": {
        "HA_SERVER_URL": "http://localhost:8000",
        "HA_API_KEY": "hak_your_api_key_here",
        "HA_DEFAULT_BOOK_ID": "your-book-uuid"
      }
    }
  }
}
```

#### SSE 模式（远程 Agent）

```bash
HA_SERVER_URL=http://localhost:8000 \
HA_API_KEY=hak_xxx \
HA_TRANSPORT=sse \
HA_SSE_PORT=3000 \
python -m home_accountant_mcp
```

### 2.5 错误处理

MCP Tool 调用失败时，返回 LLM 可理解的错误信息：

| 场景 | 错误信息格式 |
|------|------------|
| 认证失败 | `认证失败：API Key 无效或已过期，请检查配置` |
| 账本不存在 | `账本 {book_id} 不存在或无权访问` |
| 科目不存在 | `科目 {account_id} 不存在，请先调用 list_accounts 获取科目列表` |
| 借贷不平衡 | `第 {index} 条分录借贷不平衡，请检查金额` |
| 网络错误 | `无法连接到家庭记账服务器 {url}，请检查服务是否运行` |

---

## 3. 功能需求：前端 MCP 服务入口

### 3.1 功能概述

在「个人中心」设置菜单中新增「MCP 服务」入口（icon: `cpu`），位于「插件管理」下方。用户可在此查看 MCP Server 的连接配置，一键复制配置 JSON 到 AI 工具（Claude Desktop、Cursor 等）。

### 3.2 页面结构

#### 移动端（独立页面 `settings/mcp.tsx`）

```
┌──────────────────────────────────────────────────────┐
│  ← MCP 服务                                          │
├──────────────────────────────────────────────────────┤
│                                                      │
│  MCP 服务简介                                         │
│  ┌──────────────────────────────────────────────────┐│
│  │ 🤖 通过 MCP 协议，让 AI 助手直接帮你记账、查账、  ││
│  │ 分析报表。支持 Claude Desktop、Cursor 等工具。     ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  连接配置                                             │
│  ┌──────────────────────────────────────────────────┐│
│  │ 服务器地址                                        ││
│  │ http://localhost:8000                 [复制]      ││
│  ├──────────────────────────────────────────────────┤│
│  │ API Key                                          ││
│  │ hak_xxxx...xxxx                      [复制]      ││
│  │ (无可用 Key？去创建 →)                             ││
│  ├──────────────────────────────────────────────────┤│
│  │ 默认账本 ID                                       ││
│  │ uuid-xxxx-xxxx                       [复制]      ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  快速配置                                             │
│  ┌──────────────────────────────────────────────────┐│
│  │ Claude Desktop 配置           [一键复制 JSON]     ││
│  ├──────────────────────────────────────────────────┤│
│  │ Cursor 配置                   [一键复制 JSON]     ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  可用工具（10 个）                                     │
│  ┌──────────────────────────────────────────────────┐│
│  │ 📝 create_entries    智能记账                     ││
│  │ 📋 list_entries      查询分录                     ││
│  │ 🔍 get_entry         分录详情                     ││
│  │ 🗑  delete_entry      删除分录                     ││
│  │ 📊 get_balance_sheet 资产负债表                    ││
│  │ 📈 get_income_statement 损益表                    ││
│  │ 🏠 get_dashboard     仪表盘概况                    ││
│  │ 🔄 sync_balance      余额同步                     ││
│  │ 🏦 list_accounts     科目树                       ││
│  │ 🔌 list_plugins      插件列表                     ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  使用说明                                             │
│  ┌──────────────────────────────────────────────────┐│
│  │ 1. 确保家庭记账服务器已启动                        ││
│  │ 2. 安装 MCP 依赖：pip install mcp httpx           ││
│  │ 3. 复制上方配置到 AI 工具的 MCP 配置文件中          ││
│  │ 4. 重启 AI 工具即可使用                            ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

#### 桌面端（Profile 页 DetailPane）

与移动端内容一致，在右侧 DetailPane 中展示，点击「MCP 服务」菜单项时切换显示。

### 3.3 交互逻辑

| 交互 | 说明 |
|------|------|
| API Key 选择 | 自动选取用户第一个启用状态的 API Key；无可用 Key 时展示提示链接跳转至 API Key 管理页 |
| 默认账本 ID | 自动取用户当前默认账本 ID |
| 一键复制 JSON | 将服务器地址、API Key、账本 ID 填入对应 AI 工具的标准配置 JSON 格式，复制到剪贴板 |
| 复制成功 | Toast 提示「已复制到剪贴板」 |

### 3.4 配置 JSON 模板

#### Claude Desktop

```json
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/home_accountant/server",
      "env": {
        "HA_SERVER_URL": "{server_url}",
        "HA_API_KEY": "{api_key}",
        "HA_DEFAULT_BOOK_ID": "{book_id}"
      }
    }
  }
}
```

#### Cursor

```json
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "./server",
      "env": {
        "HA_SERVER_URL": "{server_url}",
        "HA_API_KEY": "{api_key}",
        "HA_DEFAULT_BOOK_ID": "{book_id}"
      }
    }
  }
}
```

> `{server_url}`、`{api_key}`、`{book_id}` 由前端自动填充实际值。

### 3.5 约束

- MCP 服务页面为纯展示 + 复制功能，不涉及后端新增 API
- 需要从已有的 API Key 列表和账本列表中读取数据（复用 `apiKeyService` 和 `bookService`）
- 桌面端和移动端共享同一套逻辑组件

---

## 4. 功能需求：分录类型转换

### 3.1 功能概述

用户在分录详情页或编辑页可以将已有分录从一种类型转换为另一种类型，系统自动调整借贷分录。避免用户需要「删除 + 重建」的繁琐操作。

### 3.2 支持的转换路径

| 源类型 | 目标类型 | 场景说明 |
|--------|---------|---------|
| `expense`（费用） | `asset_purchase`（资产购置） | 发现一笔费用实际是购买设备，应计入固定资产 |
| `asset_purchase`（资产购置） | `expense`（费用） | 购入的设备不符合资本化条件，改为费用化 |
| `income`（收入） | `repay`（还款收入） | 收到的款项实际是还款 |
| `expense`（费用） | `transfer`（转账） | 一笔费用实际是内部账户间转账 |
| `transfer`（转账） | `expense`（费用） | 转账记录实际是费用支出 |
| `transfer`（转账） | `income`（收入） | 转账记录实际是外部收入 |

> 不支持所有任意组合，仅支持上述有明确业务语义的转换路径。不合理的转换（如 `borrow` → `income`）不允许。

### 4.3 转换逻辑

1. **删除原分录的借贷明细行**（`journal_lines`）
2. **根据新类型重新生成借贷明细行**（复用 `entry_service` 中对应类型的创建逻辑）
3. **更新 `entry_type` 字段**
4. **保留原分录的不变属性**：`id`、`entry_date`、`description`、`amount`、`external_id`、`source`、`created_at`
5. **可能需要用户补充信息**：转换目标类型需要的额外字段（如 `expense` → `asset_purchase` 需要提供资产科目 ID）

### 4.4 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/entries/{entry_id}/convert` | 转换分录类型 |

**请求体**：

```json
{
  "target_type": "asset_purchase",
  "category_account_id": "uuid-of-asset-account",
  "payment_account_id": "uuid-of-bank-account"
}
```

**响应**：转换后的完整分录详情（含新的借贷明细行）。

### 4.5 前端交互

在分录详情页（`entry/[id].tsx`）增加「转换类型」按钮：

1. 点击「转换类型」→ 弹出 Modal
2. 展示当前分录类型 → 可选的目标类型列表（仅展示该类型可转换的目标）
3. 选择目标类型后，如需补充科目信息，展示科目选择器
4. 确认转换 → 调用 `POST /entries/{id}/convert`
5. 成功后刷新详情页

### 4.6 约束

- 所有来源（`manual`、`sync` 等）的分录均支持类型转换
- 转换是原子操作，在同一事务内完成
- 转换后保留原分录 ID，不生成新分录
- 转换操作会触发借贷平衡校验

---

## 5. 数据模型变更

### 5.1 无新增表

本版本不新增数据库表。MCP Server 是独立进程，通过 HTTP 调用已有 API。

### 5.2 `journal_entries` 表 — 无新增字段

分录类型转换通过更新 `entry_type` 字段 + 重建 `journal_lines` 实现，无需新增字段。

---

## 6. 版本规划更新

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

- [x] 固定资产折旧管理
- [x] 贷款管理 & 还款计划
- [x] 预算管理 & 提醒

### v0.0.3 — 已完成 ✅

- [x] 总览页桌面端布局重构
- [x] 移动端 Dashboard 移除近期分录区块

### v0.1.1 — 已完成 ✅

- [x] 分录完整编辑
- [x] 后端 `PUT /entries/{id}` 扩展
- [x] 详情页改为纯只读

### v0.2.0 — 已完成 ✅

- [x] API Key 管理（创建、列出、停用、删除）
- [x] 插件管理（注册、状态上报、查询）
- [x] 批量记账 API + 余额同步 API
- [x] 前端 API Key 管理 & 插件管理 UI

### v0.2.1 — 本版本

- [ ] MCP Server（`home_accountant_mcp` Python 模块）
  - [ ] `create_entries`：智能记账 Tool
  - [ ] `list_entries`：分录查询 Tool
  - [ ] `get_entry`：分录详情 Tool
  - [ ] `delete_entry`：删除分录 Tool
  - [ ] `get_balance_sheet`：资产负债表 Tool
  - [ ] `get_income_statement`：损益表 Tool
  - [ ] `get_dashboard`：仪表盘概况 Tool
  - [ ] `sync_balance`：余额同步 Tool
  - [ ] `list_accounts`：科目树 Tool
  - [ ] `list_plugins`：插件列表 Tool
- [ ] MCP 配置与启动（stdio + SSE 双模式）
- [ ] 前端 MCP 服务入口
  - [ ] 移动端 `settings/mcp.tsx` 页面
  - [ ] 桌面端 `profile.tsx` DetailPane 面板
  - [ ] 一键复制 Claude Desktop / Cursor 配置 JSON
  - [ ] 可用 Tools 列表展示
- [ ] 分录类型转换
  - [ ] 后端 `POST /entries/{id}/convert`
  - [ ] 前端转换 UI（详情页「转换类型」按钮 + Modal）

### （远期）

- [ ] 家庭账本 & 多人协作
- [ ] CSV 账单导入 & 流水匹配对账
- [ ] 高级模式（手动分录）
- [ ] 数据导出（CSV/Excel/PDF）
- [ ] 离线记账 + 本地 SQLite 缓存
- [ ] MCP Resources & Prompts 扩展

---

## 7. 验收标准

### 7.1 MCP 接口层

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| M-1 | stdio 模式可用 | Claude Desktop 配置后可成功连接 MCP Server，`list_accounts` 返回科目树 |
| M-2 | SSE 模式可用 | 远程 Agent 通过 SSE 连接 MCP Server 并调用 Tools |
| M-3 | 记账 Tool | 通过自然语言「今天买咖啡38块」→ LLM 调用 `create_entries` → 分录创建成功 |
| M-4 | 查询 Tool | 询问「这个月花了多少钱」→ LLM 调用 `get_income_statement` → 返回费用合计 |
| M-5 | 报表 Tool | 询问「我的净资产是多少」→ LLM 调用 `get_balance_sheet` → 返回净资产 |
| M-6 | 余额同步 Tool | 调用 `sync_balance` → 自动生成调节分录 |
| M-7 | 错误处理 | 无效科目 ID → 返回 LLM 可理解的错误提示 |
| M-8 | 认证 | 未配置 API Key → 启动时报错提示 |

### 7.2 前端 MCP 服务入口

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| F-1 | 菜单入口 | 「个人中心」设置区出现「MCP 服务」菜单项（插件管理下方） |
| F-2 | 连接配置 | 页面展示服务器地址、API Key（自动选取启用的 Key）、默认账本 ID |
| F-3 | 一键复制 Claude Desktop 配置 | 复制的 JSON 格式正确，`{api_key}` 等占位符已替换为真实值 |
| F-4 | 一键复制 Cursor 配置 | 同上 |
| F-5 | 无可用 Key | 无启用状态的 API Key 时，展示「去创建」链接 |
| F-6 | 可用工具列表 | 展示 10 个 MCP Tool 名称和说明 |
| F-7 | 桌面端一致 | 桌面端 DetailPane 与移动端页面内容一致 |

### 7.3 分录类型转换

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| C-1 | 费用→资产购置 | 转换后 `entry_type` 变更，借贷明细行正确重建 |
| C-2 | 资产购置→费用 | 同上 |
| C-3 | 费用→转账 | 转换后借方/贷方科目正确调整 |
| C-4 | 借贷平衡 | 转换后分录通过借贷平衡校验 |
| C-5 | 事务原子性 | 转换失败时全部回滚，原分录不受影响 |
| C-6 | 同步分录不可转换 | `source: sync` 的分录点击转换按钮后提示不支持 |
