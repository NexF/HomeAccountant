# 插件开发指南

本文档介绍如何为咕咕记账系统开发外部插件，实现自动记账和余额同步。

---

## 1. 概述

插件系统采用**"Server 不耦合具体业务逻辑"**的设计——Server 只提供插件注册、配置存储、状态追踪和批量记账的通用能力，具体的业务逻辑（爬虫、第三方 API 对接等）完全在外部脚本中实现。

**核心特性：**

- 插件通过 API Key 认证，独立于前端用户登录
- 配置结构由插件自行声明（`config_schema`），前端自动渲染配置表单，新增插件无需改前端代码
- 通过 `external_id` 实现幂等去重，重复同步不会产生重复分录
- 批量记账 API 事务性保证，任何一条失败则整体回滚

**架构图：**

```
外部插件脚本 (Python/Node/Shell...)
     │
     │  HTTP (API Key 认证)
     ▼
┌─────────────────────────────────┐
│         FastAPI Server          │
│  /plugins — 注册 / 状态 / 配置  │
│  /plugins/{id}/entries/batch    │
└─────────────────────────────────┘
     │
     ▼
  SQLite 数据库 (分录 + 科目)
```

---

## 2. 前置准备

### 2.1 创建 API Key

在 App 中进入「我的 → API Key 管理 → 创建 API Key」，获取以 `hak_` 为前缀的密钥。

> **注意：** API Key 仅在创建时显示一次，请妥善保存。

### 2.2 获取账本 ID 和科目 ID

插件记账需要指定账本 ID（`book_id`）和相关科目 ID。可通过以下方式获取：

```bash
# 获取账本列表
curl -H "Authorization: Bearer hak_YOUR_KEY" \
  http://localhost:8000/books

# 获取科目树
curl -H "Authorization: Bearer hak_YOUR_KEY" \
  http://localhost:8000/books/{book_id}/accounts
```

---

## 3. 插件生命周期

```
1. 注册插件         POST /plugins
2. 用户配置         (在 App 前端完成)
3. 读取配置         GET /plugins/{plugin_id}
4. 更新状态为运行中  PUT /plugins/{plugin_id}/status  { status: "running" }
5. 执行业务逻辑      (爬虫 / API 调用 / 文件解析等)
6. 批量记账         POST /plugins/{plugin_id}/entries/batch
7. 更新状态为成功    PUT /plugins/{plugin_id}/status  { status: "success" }
   或更新为失败     PUT /plugins/{plugin_id}/status  { status: "failed", error_message: "..." }
```

---

## 4. API 详解

所有插件 API 使用 API Key 认证：

```
Authorization: Bearer hak_YOUR_KEY
```

### 4.1 注册插件

```
POST /plugins
```

**幂等操作**：同名插件返回已有记录（HTTP 200），新创建返回 HTTP 201。

**请求体：**

```json
{
  "name": "招行信用卡同步",
  "type": "entry",
  "description": "自动同步招商银行信用卡账单",
  "config_schema": {
    "fields": [
      {
        "key": "card_number",
        "label": "卡号后四位",
        "type": "string",
        "required": true,
        "description": "信用卡末四位数字"
      },
      {
        "key": "target_book",
        "label": "目标账本",
        "type": "book_select",
        "required": true,
        "description": "选择要记账的目标账本"
      },
      {
        "key": "expense_account_id",
        "label": "默认费用科目",
        "type": "account_select",
        "required": true,
        "depends_on": "target_book",
        "description": "账单默认归入的费用科目"
      },
      {
        "key": "payment_account_id",
        "label": "信用卡科目",
        "type": "account_select",
        "required": true,
        "depends_on": "target_book",
        "description": "信用卡对应的负债科目"
      }
    ]
  }
}
```

**插件类型（`type`）：**

| 值 | 说明 |
|-----|------|
| `entry` | 记账插件 — 可调用批量记账 API |
| `balance` | 余额同步插件 — 可调用余额快照 API |
| `both` | 两种能力兼有 |

### 4.2 获取插件详情（含用户配置）

```
GET /plugins/{plugin_id}
```

**响应示例：**

```json
{
  "id": "abc-123",
  "name": "招行信用卡同步",
  "type": "entry",
  "has_config": true,
  "is_configured": true,
  "config": {
    "card_number": "8888",
    "target_book": "uuid-of-book",
    "expense_account_id": "uuid-of-expense-account",
    "payment_account_id": "uuid-of-credit-card-account"
  },
  "config_schema": { "fields": [...] },
  "last_sync_at": "2026-02-26T10:00:00",
  "last_sync_status": "success",
  "sync_count": 15
}
```

> 插件脚本在运行时应先读取此接口，获取用户填写的配置值。

### 4.3 更新同步状态

```
PUT /plugins/{plugin_id}/status
```

**请求体：**

```json
{ "status": "running" }
```

或：

```json
{ "status": "failed", "error_message": "网络超时，无法连接银行接口" }
```

**可选状态值：** `running`、`success`、`failed`

### 4.4 批量记账

```
POST /plugins/{plugin_id}/entries/batch
```

**请求体：**

```json
{
  "book_id": "your-book-id",
  "entries": [
    {
      "entry_type": "expense",
      "entry_date": "2026-02-25",
      "amount": 128.50,
      "category_account_id": "费用科目ID",
      "payment_account_id": "支付账户科目ID",
      "description": "美团外卖",
      "external_id": "cmb-20260225-001"
    },
    {
      "entry_type": "income",
      "entry_date": "2026-02-25",
      "amount": 15000.00,
      "category_account_id": "收入科目ID",
      "payment_account_id": "收款账户科目ID",
      "description": "2月工资",
      "external_id": "salary-202602"
    }
  ]
}
```

**限制：** 每次最多 200 条。

**响应体：**

```json
{
  "total": 2,
  "created": 1,
  "skipped": 1,
  "results": [
    { "index": 0, "external_id": "cmb-20260225-001", "status": "created", "entry_id": "new-uuid" },
    { "index": 1, "external_id": "salary-202602", "status": "skipped", "entry_id": "existing-uuid" }
  ]
}
```

> `skipped` 表示该 `external_id` 在此账本中已存在，自动跳过。

### 4.5 余额同步（提交余额快照）

```
POST /accounts/{account_id}/snapshot
```

向指定科目提交外部实际余额，系统会自动计算与账面余额的差异。如果存在差异，系统会生成一条待确认的调节分录，用户可在 App「对账」中处理。

**认证：** Flexible（API Key 或 JWT 均可）

**请求体：**

```json
{
  "external_balance": 52380.50,
  "snapshot_date": "2026-02-26"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `external_balance` | number | 是 | 外部实际余额 |
| `snapshot_date` | string | 否 | 快照日期（YYYY-MM-DD），默认今天 |

**响应体：**

```json
{
  "snapshot_id": "uuid",
  "account_id": "科目ID",
  "account_name": "招行储蓄卡",
  "account_type": "asset",
  "snapshot_date": "2026-02-26",
  "external_balance": 52380.50,
  "book_balance": 52000.00,
  "difference": 380.50,
  "status": "pending",
  "reconciliation_entry_id": "调节分录ID"
}
```

| 响应字段 | 说明 |
|---------|------|
| `book_balance` | 系统账面余额 |
| `difference` | 差异金额（外部 - 账面） |
| `status` | `matched`（无差异）或 `pending`（有差异，待确认） |
| `reconciliation_entry_id` | 如有差异，系统自动生成的调节分录 ID |

**使用示例（Python）：**

```python
# 同步银行卡余额
resp = requests.post(
    f"{BASE_URL}/accounts/{account_id}/snapshot",
    json={"external_balance": 52380.50, "snapshot_date": "2026-02-26"},
    headers=HEADERS,
)
result = resp.json()
if result["status"] == "matched":
    print("余额一致，无需调节")
else:
    print(f"差异 ¥{result['difference']}，已生成调节分录待确认")
```

---

## 5. 分录类型与字段

| 分录类型 | `entry_type` | 必填字段 |
|---------|-------------|---------|
| 费用 | `expense` | `amount`, `category_account_id`, `payment_account_id` |
| 收入 | `income` | `amount`, `category_account_id`, `payment_account_id` |
| 转账 | `transfer` | `amount`, `from_account_id`, `to_account_id` |
| 购买资产 | `asset_purchase` | `amount`, `asset_account_id`, `payment_account_id` |
| 借入 | `borrow` | `amount`, `payment_account_id`, `liability_account_id` |
| 还款 | `repay` | `principal`, `interest`, `liability_account_id`, `payment_account_id` |

**通用可选字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `description` | string | 摘要（最长 500 字符） |
| `note` | string | 备注 |
| `external_id` | string | 外部唯一标识，用于幂等去重（最长 128 字符） |
| `extra_liability_account_id` | string | 额外负债科目 ID（如贷款买房场景） |
| `extra_liability_amount` | number | 额外负债金额 |

---

## 6. 配置结构（config_schema）

插件通过 `config_schema` 声明需要用户填写的配置项，前端会根据 schema 自动渲染表单。

### 6.1 字段类型

| `type` | 前端控件 | 说明 |
|--------|---------|------|
| `string` | 文本输入框 | 普通字符串 |
| `number` | 数字输入框 | 数值类型 |
| `boolean` | 开关 | 布尔值 |
| `select` | 选项按钮组 | 从预定义选项中选择，需提供 `options` |
| `book_select` | 账本选择器 | 下拉选择用户有权访问的账本，值为 `book_id` |
| `account_select` | 科目树选择器 | 从指定账本中选择科目，值为科目 ID。**必须**配合 `depends_on` 指向一个 `book_select` 字段 |
| `secret` | 密码输入框 | 敏感信息（如 Token），输入时隐藏显示 |

### 6.2 字段定义

```json
{
  "key": "api_token",
  "label": "API Token",
  "type": "secret",
  "required": true,
  "default": "",
  "description": "从第三方平台获取的 API 访问令牌"
}
```

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | 是 | 配置键名 |
| `label` | string | 是 | 显示标签 |
| `type` | string | 是 | 字段类型（见上表） |
| `required` | boolean | 否 | 是否必填，默认 false |
| `default` | any | 否 | 默认值 |
| `description` | string | 否 | 描述文字 |
| `options` | array | 否 | 仅 `select` 类型，格式：`[{ "label": "显示文字", "value": "存储值" }]` |
| `depends_on` | string | 否 | 级联依赖字段的 `key`。`account_select` 类型**必填**，须指向 `book_select` 字段。前端在依赖字段未选时禁用当前字段，依赖字段变更时自动清空当前值 |

### 6.3 级联依赖（book_select → account_select）

由于插件是**用户级**的（不绑定特定账本），而科目是**账本级**的，因此 `account_select` 字段必须先知道目标账本才能加载正确的科目树。

通过 `depends_on` 实现级联：

```json
{
  "fields": [
    {
      "key": "target_book",
      "label": "目标账本",
      "type": "book_select",
      "required": true,
      "description": "选择要记账的目标账本"
    },
    {
      "key": "expense_account_id",
      "label": "费用科目",
      "type": "account_select",
      "required": true,
      "depends_on": "target_book",
      "description": "默认费用归入的科目"
    }
  ]
}
```

**前端行为：**
- `target_book` 未选时，`expense_account_id` 禁用（灰色 + "请先选择账本"）
- `target_book` 切换后，`expense_account_id` 值自动清空，科目选择器加载新账本的科目树

**服务端校验：**
- `book_select`：校验用户有权访问该账本（owner 或 member）
- `account_select`：从 config 中读取 `depends_on` 指向的 `book_id`，校验科目属于该账本

### 6.4 完整示例

```json
{
  "fields": [
    {
      "key": "api_token",
      "label": "API Token",
      "type": "secret",
      "required": true,
      "description": "平台 API 令牌"
    },
    {
      "key": "sync_mode",
      "label": "同步模式",
      "type": "select",
      "required": true,
      "default": "incremental",
      "options": [
        { "label": "增量同步", "value": "incremental" },
        { "label": "全量同步", "value": "full" }
      ]
    },
    {
      "key": "target_book",
      "label": "目标账本",
      "type": "book_select",
      "required": true,
      "description": "选择要记账的目标账本"
    },
    {
      "key": "expense_account_id",
      "label": "费用科目",
      "type": "account_select",
      "required": true,
      "depends_on": "target_book",
      "description": "默认费用归入的科目"
    },
    {
      "key": "auto_categorize",
      "label": "自动分类",
      "type": "boolean",
      "default": true,
      "description": "是否根据商户名自动匹配费用科目"
    }
  ]
}
```

---

## 7. 完整插件示例

以下是一个 Python 插件脚本的完整示例：

```python
#!/usr/bin/env python3
"""示例插件：同步 CSV 账单到咕咕记账系统"""

import csv
import requests

BASE_URL = "http://localhost:8000"
API_KEY = "hak_YOUR_API_KEY_HERE"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}
PLUGIN_NAME = "csv-bill-sync"


def register_plugin():
    """注册插件（幂等）"""
    resp = requests.post(f"{BASE_URL}/plugins", json={
        "name": PLUGIN_NAME,
        "type": "entry",
        "description": "从 CSV 文件导入账单",
        "config_schema": {
            "fields": [
                {
                    "key": "target_book",
                    "label": "目标账本",
                    "type": "book_select",
                    "required": True,
                },
                {
                    "key": "expense_account_id",
                    "label": "默认费用科目",
                    "type": "account_select",
                    "required": True,
                    "depends_on": "target_book",
                },
                {
                    "key": "payment_account_id",
                    "label": "支付账户",
                    "type": "account_select",
                    "required": True,
                    "depends_on": "target_book",
                },
            ]
        }
    }, headers=HEADERS)
    resp.raise_for_status()
    return resp.json()


def get_config(plugin_id: str) -> dict:
    """获取用户配置"""
    resp = requests.get(f"{BASE_URL}/plugins/{plugin_id}", headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("is_configured"):
        raise RuntimeError("插件尚未配置，请在 App 中完成配置后再运行")
    return data["config"]


def update_status(plugin_id: str, status: str, error_message: str = None):
    """更新同步状态"""
    body = {"status": status}
    if error_message:
        body["error_message"] = error_message
    requests.put(f"{BASE_URL}/plugins/{plugin_id}/status", json=body, headers=HEADERS)


def sync_csv(plugin_id: str, csv_path: str):
    """解析 CSV 并批量记账"""
    config = get_config(plugin_id)
    book_id = config["target_book"]  # 从配置中读取目标账本
    update_status(plugin_id, "running")

    try:
        entries = []
        with open(csv_path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                entries.append({
                    "entry_type": "expense",
                    "entry_date": row["date"],
                    "amount": float(row["amount"]),
                    "category_account_id": config["expense_account_id"],
                    "payment_account_id": config["payment_account_id"],
                    "description": row["description"],
                    "external_id": f"csv-{row['transaction_id']}",
                })

        # 分批提交（每批最多 200 条）
        for i in range(0, len(entries), 200):
            batch = entries[i:i+200]
            resp = requests.post(
                f"{BASE_URL}/plugins/{plugin_id}/entries/batch",
                json={"book_id": book_id, "entries": batch},
                headers=HEADERS,
            )
            resp.raise_for_status()
            result = resp.json()
            print(f"批次 {i//200+1}: 创建 {result['created']} 条, 跳过 {result['skipped']} 条")

        update_status(plugin_id, "success")
        print("同步完成")

    except Exception as e:
        update_status(plugin_id, "failed", str(e))
        raise


if __name__ == "__main__":
    plugin = register_plugin()
    plugin_id = plugin["id"]
    print(f"插件已注册: {plugin_id}")

    # 从配置中读取目标账本，直接同步
    sync_csv(plugin_id, csv_path="bills.csv")
```

---

## 8. MCP 集成

系统内置 MCP（Model Context Protocol）服务器，可作为 AI 客户端（Claude Desktop、Cursor 等）的工具提供者，通过自然语言完成记账操作。

### 8.1 配置

通过环境变量配置 MCP Server：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `HA_SERVER_URL` | `http://localhost:8000` | 后端 API 地址 |
| `HA_AUTH_TYPE` | `api_key` | 认证方式：`api_key` 或 `jwt_token` |
| `HA_API_KEY` | — | API Key |
| `HA_DEFAULT_BOOK_ID` | — | 默认账本 ID |
| `HA_TRANSPORT` | `stdio` | 传输方式：`stdio` 或 `sse` |
| `HA_SSE_PORT` | `3000` | SSE 模式端口 |

### 8.2 启动

```bash
cd server
python -m mcp_server
```

### 8.3 Claude Desktop 配置

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/home_accountant/server",
      "env": {
        "HA_API_KEY": "hak_YOUR_KEY",
        "HA_DEFAULT_BOOK_ID": "your-book-id"
      }
    }
  }
}
```

### 8.4 可用工具（10 个）

| 工具 | 说明 |
|------|------|
| `create_entries` | 批量创建分录 |
| `list_entries` | 查询分录列表（支持日期/类型筛选） |
| `get_entry` | 获取单条分录详情 |
| `delete_entry` | 删除分录 |
| `get_balance_sheet` | 获取资产负债表 |
| `get_income_statement` | 获取损益表 |
| `get_dashboard` | 获取仪表盘概览 |
| `sync_balance` | 提交科目余额快照 |
| `list_accounts` | 获取科目树 |
| `list_plugins` | 查看已注册插件列表 |

> MCP Server 会自动注册一个名为 `mcp-agent` 的虚拟插件，其记账操作同样可在 App「插件管理」中追踪。

---

## 9. 常见问题

**Q: 插件注册后用户在哪里配置？**

在 App 中进入「我的 → 插件管理」，点击对应插件即可看到动态表单并填写配置。

**Q: 如何实现幂等去重？**

为每条分录设置唯一的 `external_id`（如交易流水号），批量记账 API 会自动检查：相同 `book_id` + `external_id` 的分录已存在时跳过，返回 `status: "skipped"`。

**Q: 批量记账的事务保证是什么？**

一次请求中的所有分录在同一个数据库事务中创建。如果任何一条失败，整批回滚，不会出现"部分成功"的情况。

**Q: 删除 API Key 会怎样？**

删除 API Key 会**级联删除**该 Key 下注册的所有插件。已通过该插件创建的分录不受影响。

**Q: 插件同步创建的分录和手动记账有什么区别？**

插件创建的分录 `source` 字段为 `"sync"`，手动创建为 `"manual"`。在前端账本页可区分来源。
