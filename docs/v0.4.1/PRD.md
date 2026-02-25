# v0.4.1 — 插件配置 + 账单导入

> **版本：v0.4.1**
> **创建日期：2026-02-25**
> **基于版本：v0.2.0（插件系统）**
> **状态：规划中**
> **本版本变更：为插件增加 Schema-Free 动态配置能力；新增内置账单文件导入功能**

---

## 1. 背景

v0.2.0 引入了插件系统（记账插件、余额同步插件），插件通过 API Key 认证调用 Server API 完成自动记账和余额同步。当前存在两个问题：

### 1.1 插件缺少配置能力

插件只有名称、类型、描述等元数据，**缺少运行时配置能力**。实际场景中，插件需要用户提供配置信息才能正常工作：

| 插件 | 需要的配置 |
|------|-----------|
| 招行爬虫 | 关联科目（映射到哪个银行卡科目）、同步天数、卡号后四位 |
| 股票账户同步 | 关联投资科目、券商名称 |

当前只能把配置硬编码在脚本中或通过环境变量管理，用户无法在前端界面上配置插件参数。

### 1.2 缺少微信账单导入

用户需要将微信导出的账单文件导入系统。这类操作是**用户主动触发的一次性导入**，与插件（持续运行的外部脚本自动同步）的模式不同，不适合走插件体系，应作为 Server 内置功能：

| 类型 | 是否插件 | 数据流 | 示例 |
|------|---------|--------|------|
| **文件导入** | ❌ 内置功能 | 用户上传文件 → Server 解析 → 记账 | 微信账单 xlsx |
| **自动同步** | ✅ 外部插件 | 外部脚本定时运行 → 调 API 推送 | 招行爬虫、券商 API |

## 2. 目标

本版本包含两个功能模块：

### 2.1 插件动态配置

| 能力 | 说明 |
|------|------|
| 插件声明配置结构 | 插件注册时上报 `config_schema`（自己需要哪些配置项），Server 存储 |
| 用户填写配置 | 前端根据 `config_schema` 动态渲染表单，用户填写后保存到 `config` |
| 插件读取配置 | 插件运行时通过 `GET /plugins/{id}` 获取用户填写的 `config` |

### 2.2 微信账单导入

| 能力 | 说明 |
|------|------|
| 文件上传 | 用户在前端上传微信账单 xlsx 文件 |
| 格式解析 | Server 内置微信账单解析器，自动跳过文件头/汇总行，提取交易明细 |
| 预览确认 | 解析后展示预览列表，用户确认默认科目后导入 |
| 导入记账 | 复用 `batch_entry_service` 批量创建分录，支持 `external_id` 去重 |

### 设计原则

- **Server 不耦合具体插件逻辑**：配置结构由插件自己定义，Server 只存 JSON
- **前端动态渲染**：根据 schema 自动生成表单，新增插件无需改前端代码
- **向后兼容**：现有插件不受影响，`config_schema` 和 `config` 默认为空
- **导入与插件分离**：文件导入是 Server 内置功能，有独立的 UI 入口，不走插件注册流程

## 3. 数据模型变更

### 3.1 `plugins` 表新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `config_schema` | JSON (TEXT) | `null` | 插件声明的配置项定义，由插件注册/更新时上报 |
| `config` | JSON (TEXT) | `null` | 用户在前端填写的实际配置值 |

迁移方式：独立迁移脚本（`server/scripts/` 下），不耦合 `init_db()`。

### 3.2 `config_schema` 格式

插件注册时上报的配置结构描述，定义该插件需要哪些配置项：

```json
{
  "fields": [
    {
      "key": "account_id",
      "label": "关联科目",
      "type": "account_select",
      "required": true,
      "description": "选择该插件同步数据对应的科目"
    },
    {
      "key": "sync_days",
      "label": "同步天数",
      "type": "number",
      "required": false,
      "default": 30,
      "description": "每次同步最近多少天的数据"
    },
    {
      "key": "card_suffix",
      "label": "卡号后四位",
      "type": "string",
      "required": false,
      "description": "用于标识银行卡"
    },
    {
      "key": "auto_confirm",
      "label": "自动确认分录",
      "type": "boolean",
      "required": false,
      "default": true
    },
    {
      "key": "default_category",
      "label": "默认分类",
      "type": "select",
      "required": false,
      "options": [
        { "label": "餐饮饮食", "value": "food" },
        { "label": "交通出行", "value": "transport" },
        { "label": "待分类", "value": "unclassified" }
      ],
      "default": "unclassified"
    },
    {
      "key": "cookie_path",
      "label": "Cookie 文件路径",
      "type": "secret",
      "required": false,
      "description": "敏感信息，保存后不会明文展示"
    }
  ]
}
```

### 3.3 支持的字段类型

| type | 前端渲染 | 值类型 | 说明 |
|------|---------|--------|------|
| `string` | TextInput | `string` | 普通文本输入 |
| `number` | 数字输入框 | `number` | 整数或小数 |
| `boolean` | Switch 开关 | `boolean` | true/false |
| `select` | 下拉选择 | `string` | 需配合 `options: [{label, value}]` |
| `account_select` | 科目选择器 | `string` | 复用现有科目选择组件，值为 `account_id` |
| `secret` | 密码输入框 | `string` | 保存后回显为 `***`，编辑时重新输入 |

### 3.4 字段属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 配置项键名，在 `config` 中作为 key |
| `label` | string | ✅ | 前端展示的标签名 |
| `type` | string | ✅ | 字段类型（见上表） |
| `required` | boolean | ❌ | 是否必填，默认 `false` |
| `default` | any | ❌ | 默认值 |
| `description` | string | ❌ | 配置项描述/帮助文字 |
| `options` | array | ❌ | `select` 类型时必填，`[{label, value}]` |

## 4. API 变更

### 4.1 注册插件 — `POST /plugins`（修改）

请求体新增 `config_schema` 字段：

```json
{
  "name": "招行储蓄卡同步",
  "type": "both",
  "description": "自动同步招商银行储蓄卡交易流水和余额",
  "config_schema": {
    "fields": [
      { "key": "account_id", "label": "关联科目", "type": "account_select", "required": true },
      { "key": "sync_days", "label": "同步天数", "type": "number", "default": 30 }
    ]
  }
}
```

- 幂等语义不变：`name` 已存在时更新 `config_schema`（以及 `type`、`description`）
- `config_schema` 为可选字段，不传则为 `null`（插件无需用户配置）

### 4.2 获取插件详情 — `GET /plugins/{plugin_id}`（修改）

响应新增 `config_schema` 和 `config` 字段：

```json
{
  "id": "uuid",
  "name": "招行储蓄卡同步",
  "type": "both",
  "config_schema": {
    "fields": [
      { "key": "account_id", "label": "关联科目", "type": "account_select", "required": true },
      { "key": "sync_days", "label": "同步天数", "type": "number", "default": 30 }
    ]
  },
  "config": {
    "account_id": "uuid-of-cmb-savings",
    "sync_days": 7
  },
  "last_sync_at": "2026-02-25T10:00:00",
  "last_sync_status": "success",
  "..."
}
```

插件脚本运行时通过此接口读取 `config` 字段获取用户配置。

### 4.3 更新插件配置 — `PUT /plugins/{plugin_id}/config`（新增）

用户在前端填写配置后调用此接口保存。

**认证方式**：JWT Token（用户操作）

**请求体**：

```json
{
  "config": {
    "account_id": "uuid-of-cmb-savings",
    "sync_days": 7,
    "card_suffix": "6688"
  }
}
```

**校验规则**：

| 规则 | 说明 |
|------|------|
| `required` 字段必须有值 | `config_schema` 中 `required: true` 的字段不能为空 |
| 类型校验 | `number` 类型的值必须是数字，`boolean` 必须是布尔等 |
| `select` 值校验 | 值必须在 `options` 定义的范围内 |
| `account_select` 校验 | `account_id` 必须存在于用户的当前账本中 |
| 未知字段忽略 | `config` 中不在 `config_schema.fields` 里的 key 会被过滤掉 |

**成功响应**：`200` + 更新后的完整 `PluginResponse`

**错误响应**：

| 场景 | HTTP 状态 | 说明 |
|------|-----------|------|
| 插件无 `config_schema` | `400` | 该插件不支持配置 |
| 必填字段缺失 | `422` | 返回缺失字段列表 |
| 类型不匹配 | `422` | 返回错误字段和期望类型 |
| 插件不存在 | `404` | |
| 无权限 | `403` | 非插件所属用户 |

### 4.4 插件列表 — `GET /plugins`（修改）

响应中每个插件新增 `has_config`（布尔）和 `is_configured`（布尔）字段，方便前端判断是否显示配置按钮和配置状态：

| 字段 | 说明 |
|------|------|
| `has_config` | `config_schema` 不为空 → `true` |
| `is_configured` | `config` 不为空且必填字段已填 → `true` |

> 列表接口不返回 `config_schema` 和 `config` 的完整内容（节省带宽），需要时通过详情接口获取。

## 5. 前端变更

### 5.1 插件卡片增加「配置」按钮

在插件卡片操作区新增「配置」按钮，仅当 `has_config === true` 时显示：

```
┌────────────────────────────────────────────────┐
│  🔌 招行储蓄卡同步                   [记账+同步] │
│  关联 Key：hak_a1b2c3d4...                     │
│  最后同步：2026-02-13 14:30   ● 成功            │
│  累计同步：23 次                                 │
│  配置状态：✅ 已配置                             │  ← 新增
│                            [配置]  [删除]       │  ← 配置按钮
└────────────────────────────────────────────────┘
```

配置状态展示：

| `has_config` | `is_configured` | 展示 |
|---|---|---|
| `false` | - | 不显示配置相关内容 |
| `true` | `false` | ⚠️ 待配置（橙色） |
| `true` | `true` | ✅ 已配置（绿色） |

### 5.2 配置面板

点击「配置」按钮后：

- **桌面端**：在插件卡片下方展开配置表单（inline 展开）
- **移动端**：跳转到独立配置页面（`router.push`）

```
┌────────────────────────────────────────────────┐
│  🔌 招行储蓄卡同步                   [记账+同步] │
│  ...                                           │
│                            [配置]  [删除]       │
├────────────────────────────────────────────────┤
│  ▼ 插件配置                                     │
│                                                │
│  关联科目 *                                     │
│  ┌──────────────────────────────────────────┐  │
│  │ 招行储蓄卡 (1001-02)              ▾      │  │
│  └──────────────────────────────────────────┘  │
│  选择该插件同步数据对应的科目                     │
│                                                │
│  同步天数                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ 30                                       │  │
│  └──────────────────────────────────────────┘  │
│  每次同步最近多少天的数据                         │
│                                                │
│  卡号后四位                                     │
│  ┌──────────────────────────────────────────┐  │
│  │ 6688                                     │  │
│  └──────────────────────────────────────────┘  │
│  用于标识银行卡                                  │
│                                                │
│  自动确认分录                                    │
│  [========○] 开                                │
│                                                │
│                            [取消]  [保存配置]   │
└────────────────────────────────────────────────┘
```

### 5.3 表单渲染规则

| 字段类型 | 组件 | 说明 |
|---------|------|------|
| `string` | `TextInput` | 单行文本 |
| `number` | `TextInput` + `keyboardType="numeric"` | 数字输入 |
| `boolean` | `Switch` | 开关 |
| `select` | 下拉选择 / `BottomSheet`（移动端） | 从 `options` 中选择 |
| `account_select` | 复用科目选择器组件 | 值为 `account_id` |
| `secret` | `TextInput` + `secureTextEntry` | 已有值时显示 `••••••••`，点击编辑可修改 |

- 必填字段标签后显示 `*`
- `description` 渲染为输入框下方的帮助文字（灰色小字）
- `default` 值作为表单初始值（用户未填写过时）
- 保存时前端做基础校验（必填、类型），后端做完整校验

### 5.4 移动端配置页面

新增路由 `app/settings/plugin-config.tsx`：

```
┌─────────────────────────────────────────────┐
│  ← 返回          插件配置                     │
├─────────────────────────────────────────────┤
│                                             │
│  招行储蓄卡同步                              │
│  自动同步招商银行储蓄卡交易流水和余额          │
│                                             │
│  ─── 配置项 ───                              │
│                                             │
│  关联科目 *                                  │
│  [招行储蓄卡 (1001-02)           ▾]         │
│                                             │
│  同步天数                                    │
│  [30                              ]         │
│                                             │
│  卡号后四位                                  │
│  [6688                            ]         │
│                                             │
│  自动确认分录                                │
│  [========○]                                │
│                                             │
│  [       保存配置       ]                    │
│                                             │
└─────────────────────────────────────────────┘
```

## 6. 微信账单导入

### 6.1 概述

Server 内置微信账单解析能力。用户在前端上传微信导出的 xlsx 文件，Server 解析后返回预览，用户确认默认科目后批量导入分录。

### 6.2 微信账单 xlsx 格式

基于实际文件分析（`微信支付账单流水文件(20260217-20260224)_20260224173400.xlsx`），格式如下：

```
Row 0:  微信支付账单明细                     ← 标识行（用于格式识别）
Row 1:  微信昵称：[real nex]
Row 2:  起始时间：[2026-02-17] 终止时间：[2026-02-24]
Row 3:  导出类型：[全部]
Row 4:  导出时间：[2026-02-24 17:34:00]
Row 5:  （空行）
Row 6:  共55笔记录
Row 7:  收入：14笔 244.48元
Row 8:  支出：41笔 621.19元
Row 9:  中性交易：0笔 0.00元
Row 10-14: 注释说明
Row 15: --------分隔线--------
Row 16: 交易时间 | 交易类型 | 交易对方 | 商品 | 收/支 | 金额(元) | 支付方式 | 当前状态 | 交易单号 | 商户单号 | 备注  ← 表头
Row 17+: 数据行
```

**表头列定义**（第 16 行）：

| 列索引 | 列名 | 说明 | 使用方式 |
|--------|------|------|---------|
| 0 | 交易时间 | `2026-02-24 17:26:13` | → 分录日期 |
| 1 | 交易类型 | 商户消费、微信红包、转账、扫二维码付款等 | → 分录描述辅助 |
| 2 | 交易对方 | 商户名或个人昵称 | → 分录描述 |
| 3 | 商品 | 商品名或备注 | → 分录描述辅助 |
| 4 | 收/支 | `收入` / `支出` / `中性交易` | → 判断借贷方向 |
| 5 | 金额(元) | `¥35.50`（带 ¥ 前缀） | → 金额（需去掉 ¥） |
| 6 | 支付方式 | `零钱`、`招商银行储蓄卡(3717)` 等 | → 参考信息 |
| 7 | 当前状态 | `支付成功`、`已存入零钱`、`对方已收钱` 等 | → 过滤用 |
| 8 | 交易单号 | 微信交易号 | → `external_id`（去重用） |
| 9 | 商户单号 | 商户侧单号 | → 参考信息 |
| 10 | 备注 | 用户备注 | → 分录描述辅助 |

### 6.3 解析规则

1. **定位数据起始行**：找到第一个单元格值为 `交易时间` 的行作为表头，下一行开始为数据
2. **跳过非成功状态**：`当前状态` 不含 `成功`、`已存入`、`已收钱`、`已转账`、`已到账` 的行跳过
3. **金额解析**：去掉 `¥` 前缀，转为 float；金额统一为**正数**，收支方向由 `direction` 字段表达（`"支出"` / `"收入"` / `"中性交易"`）
4. **描述生成**：`交易对方 - 商品`（商品为 `/` 时只取交易对方）
5. **external_id**：`wechat_{交易单号}`（确保唯一性）
6. **中性交易处理**：`收/支` 列为 `中性交易` 的行（充值/提现/零钱通转入转出等）正常解析，`direction` 标记为 `"中性交易"`。此类交易为资产账户间互转，导入时需用户指定转出和转入两个资产科目

### 6.4 数据模型

#### `import_tasks` 表（新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `book_id` | UUID FK | 所属账本 |
| `user_id` | UUID FK | 操作用户 |
| `format` | VARCHAR | 固定为 `wechat` |
| `original_filename` | VARCHAR | 原始文件名 |
| `total_rows` | INTEGER | 解析出的有效行数 |
| `imported_rows` | INTEGER | 实际导入行数（去重后） |
| `skipped_rows` | INTEGER | 跳过行数（重复） |
| `status` | VARCHAR | `parsed` / `partial` / `imported` / `failed` |
| `error_message` | TEXT | 失败原因 |
| `parsed_data` | JSON | 解析后的标准化数据（临时存储，确认导入后可清空） |
| `config` | JSON | 各批次的科目映射记录 |
| `created_at` | TIMESTAMP | 创建时间 |

### 6.5 API

#### 6.5.1 上传并解析 — `POST /books/{book_id}/import/upload`

**认证**：JWT

**请求**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 微信账单 xlsx 文件 |

**成功响应** `200`：

```json
{
  "task_id": "uuid",
  "format": "wechat",
  "total_rows": 55,
  "rows": [
    {
      "index": 0,
      "date": "2026-02-24",
      "description": "武汉蔡林记餐饮管理有限公司 - 蔡林记奥山世纪城店",
      "amount": 25.00,
      "direction": "支出",
      "payment_method": "招商银行储蓄卡(3717)",
      "external_id": "wechat_4200002984202602246232095463",
      "is_duplicate": false
    },
    {
      "index": 1,
      "date": "2026-02-24",
      "description": "Estela",
      "amount": 9.99,
      "direction": "收入",
      "payment_method": "/",
      "external_id": "wechat_1000031001000602246315363245890",
      "is_duplicate": false
    }
  ],
  "filters": {
    "directions": ["支出", "收入", "中性交易"],
    "payment_methods": ["招商银行储蓄卡(3717)", "零钱", "中国银行借记卡(5765)"]
  },
  "summary": {
    "income_count": 14,
    "income_total": 244.48,
    "expense_count": 41,
    "expense_total": 621.19,
    "neutral_count": 0,
    "neutral_total": 0.00,
    "duplicate_count": 0
  },
  "status": "parsed"
}
```

**错误响应**：

| 场景 | HTTP 状态 | 说明 |
|------|-----------|------|
| 非 xlsx 文件 | `400` | 仅支持 .xlsx 格式 |
| 文件过大 | `413` | 超过 10MB |
| 非微信账单 | `422` | 未找到「微信支付账单明细」标识 |
| 无有效数据行 | `422` | 解析后无交易记录 |

#### 6.5.2 确认导入 — `POST /books/{book_id}/import/{task_id}/confirm`

**说明**：用户在前端按 `direction` / `payment_method` 筛选后，为所选行指定科目并确认导入。支持多次确认（每次导入一批），通过 `external_id` 保证幂等——已导入的行会被跳过。

**请求体**：

```json
{
  "entries": [
    {
      "indexes": [0, 3, 5, 7],
      "expense_account_id": "uuid-of-daily-expense",
      "payment_account_id": "uuid-of-wechat-wallet",
      "income_account_id": null,
      "from_account_id": null,
      "to_account_id": null
    },
    {
      "indexes": [1, 12],
      "income_account_id": "uuid-of-salary-income",
      "payment_account_id": "uuid-of-bank-card",
      "expense_account_id": null,
      "from_account_id": null,
      "to_account_id": null
    },
    {
      "indexes": [50],
      "expense_account_id": null,
      "income_account_id": null,
      "payment_account_id": null,
      "from_account_id": "uuid-of-bank-card",
      "to_account_id": "uuid-of-wechat-wallet"
    }
  ]
}
```

- `entries`：分组数组，每组包含要导入的行索引（对应 `rows[].index`）及该组的目标科目
- 支出行需指定 `expense_account_id`（费用科目）和 `payment_account_id`（支付资产科目）
- 收入行需指定 `income_account_id`（收入科目）和 `payment_account_id`（收款资产科目）
- 中性交易行需指定 `from_account_id`（转出资产科目）和 `to_account_id`（转入资产科目）
- 同一 `task_id` 可多次调用 confirm，每次导入不同的行；已导入的 `external_id` 自动跳过（幂等）

**成功响应** `200`：

```json
{
  "task_id": "uuid",
  "status": "imported",
  "imported_rows": 6,
  "skipped_rows": 0,
  "total_confirmed": 52
}
```

- `imported_rows`：本次实际导入行数
- `skipped_rows`：本次因重复跳过的行数
- `total_confirmed`：该 task 累计已导入行数

- 支出分录：借记 `expense_account_id`（费用科目），贷记 `payment_account_id`（资产科目）
- 收入分录：借记 `payment_account_id`（资产科目），贷记 `income_account_id`（收入科目）
- 中性交易分录：借记 `to_account_id`，贷记 `from_account_id`（资产账户间互转）
- 所有分录 `source` 标记为 `"import"`
- **幂等保证**：`external_id`（`wechat_{交易单号}`）在 DB 层唯一，`skip_duplicates: true` 时跳过已存在的行；即使同一 task 多次 confirm 或同一文件重复上传，也不会产生重复分录

#### 6.5.3 导入历史 — `GET /books/{book_id}/import/history`

```json
[
  {
    "id": "uuid",
    "format": "wechat",
    "original_filename": "微信支付账单流水文件(20260217-20260224).xlsx",
    "total_rows": 55,
    "imported_rows": 52,
    "skipped_rows": 3,
    "status": "imported",
    "created_at": "2026-02-25T10:00:00"
  }
]
```

#### 6.5.4 撤销导入 — `DELETE /books/{book_id}/import/{task_id}`

按 `task_id` 关联的 `external_id` 批量删除分录。

```json
{
  "deleted_count": 52
}
```

### 6.6 前端 UI

复用 `profile.tsx` 中已预留的「数据导入/导出」入口（第 133 行），将其激活。

#### 6.6.1 前端入口

- **`profile.tsx`**：移除 `hint="即将推出"`，绑定 `onPress`
  - 桌面端：`handleMenuPress('data-import', '/settings/data-import')` → 右侧面板渲染 `DataImportPane`
  - 移动端：跳转 `/settings/data-import`
- **`DetailPane` 类型**：新增 `'data-import'`

#### 6.6.2 导入页面

```
┌─────────────────────────────────────────────────┐
│  📥 微信账单导入                                  │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │                                         │    │
│  │  📄 点击上传微信账单 xlsx 文件           │    │
│  │     从微信「账单」→「导出账单」获取     │    │
│  │     支持 .xlsx 文件，最大 10MB          │    │
│  │                                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ── 导入历史 ──                                  │
│                                                 │
│  02-25  微信账单  55条中导入52条  ✓   [撤销]     │
└─────────────────────────────────────────────────┘
```

#### 6.6.3 解析预览

上传成功后展示：

```
┌─────────────────────────────────────────────────────┐
│  微信支付账单流水文件(20260217-20260224).xlsx         │
│  收入 14 笔 ¥244.48  |  支出 41 笔 ¥621.19  |  中性 0 笔 │
│  重复 0 条                                           │
│                                                     │
│  ── 筛选 ──                                          │
│  收/支：  [全部 ▾]  [支出]  [收入]  [中性交易]         │
│  支付方式：[全部 ▾]  [招商银行储蓄卡(3717)]  [零钱]   │
│                                                     │
│  ┌────┬─────────┬──────────────────┬────────┐       │
│  │ ☑  │ 日期    │ 描述              │ 金额   │       │
│  ├────┼─────────┼──────────────────┼────────┤       │
│  │ ☑  │ 02-24   │ 蔡林记 - 奥山世纪城│ ¥25.00 │       │
│  │ ☑  │ 02-24   │ Estela (微信红包)  │ ¥9.99  │       │
│  │ ☑  │ 02-24   │ Estela - 转账      │ ¥5.20  │       │
│  │ ☑  │ 02-23   │ 杭州青奇 - 先乘后付│ ¥3.00  │       │
│  │ ...│         │                    │        │       │
│  └────┴─────────┴──────────────────┴────────┘       │
│                                                     │
│  已选 41 条（支出）                                   │
│  费用科目  [日常消费 ▾]                               │
│  支付科目  [零钱 ▾]                                   │
│                                                     │
│           [取消]  [确认导入 41 条]                     │
└─────────────────────────────────────────────────────┘
```

**筛选 + 分批导入流程**：

1. 上传解析后，返回**全量行**及可用的筛选维度（`directions` / `payment_methods`）
2. 用户通过筛选器缩小范围（如只看「支出」+「招商银行储蓄卡」），列表实时过滤
3. 可通过复选框进一步勾选/取消个别行
4. 为当前选中的行**选择目标科目**（支出/收入需选费用/收入科目 + 支付资产科目；中性交易需选转出/转入两个资产科目），点击「确认导入」
5. 导入完成后，已导入的行标记为灰色/已导入状态，用户可切换筛选条件继续导入下一批
6. 重复步骤 2-5，直到所有需要导入的行处理完毕
7. `task.status` 在部分导入后变为 `partial`，全部导入后变为 `imported`

## 7. 涉及文件变更

### 7.1 后端修改（插件配置）

| 文件 | 变更 |
|------|------|
| `server/app/models/plugin.py` | `Plugin` 模型新增 `config_schema`、`config` 字段（JSON/TEXT） |
| `server/app/schemas/plugin.py` | `PluginCreateRequest` 新增 `config_schema`；`PluginResponse` 新增 `config_schema`、`config`、`has_config`、`is_configured`；新增 `PluginConfigUpdateRequest` |
| `server/app/services/plugin_service.py` | `create_plugin` 处理 `config_schema`；新增 `update_plugin_config` 含校验逻辑 |
| `server/app/routers/plugins.py` | 新增 `PUT /plugins/{plugin_id}/config` 端点 |

### 7.2 后端新增（插件配置）

| 文件 | 说明 |
|------|------|
| `server/scripts/migrate_plugin_config.py` | 独立迁移脚本，为已有 `plugins` 表添加 `config_schema` 和 `config` 列 |

### 7.3 后端新增（微信账单导入）

| 文件 | 说明 |
|------|------|
| `server/app/models/import_task.py` | `ImportTask` 模型 |
| `server/app/schemas/import_task.py` | 导入相关的请求/响应 Schema |
| `server/app/routers/import_router.py` | 导入 API 路由（upload / confirm / history / delete） |
| `server/app/services/import_service.py` | 导入服务（解析 xlsx、调用 batch_entry_service） |
| `server/app/parsers/__init__.py` | 解析器包 |
| `server/app/parsers/wechat.py` | 微信账单 xlsx 解析器 |

### 7.4 前端修改

| 文件 | 变更 |
|------|------|
| `client/services/pluginService.ts` | 新增 `updateConfig(pluginId, config)` 方法；`PluginResponse` 类型新增字段 |
| `client/features/plugin/PluginsPane.tsx` | 插件卡片增加配置状态展示 + 「配置」按钮 + 展开式配置表单 |
| `client/app/settings/plugins.tsx` | 移动端插件列表增加配置状态展示 + 跳转配置页 |
| `client/app/(tabs)/profile.tsx` | 「数据导入/导出」菜单项移除 `hint`，绑定 `onPress`；桌面端渲染 `DataImportPane` |
| `client/features/profile/types.ts` | `DetailPane` 新增 `'data-import'` |

### 7.5 前端新增

| 文件 | 说明 |
|------|------|
| `client/features/plugin/PluginConfigForm.tsx` | 动态配置表单组件，根据 `config_schema` 渲染表单 |
| `client/app/settings/plugin-config.tsx` | 移动端插件配置页面 |
| `client/services/importService.ts` | 导入 API 服务 |
| `client/features/import/DataImportPane.tsx` | 导入面板（上传 + 预览 + 历史） |
| `client/features/import/ImportPreview.tsx` | 解析预览组件（含筛选、行选择、科目指定） |
| `client/features/import/ImportFilterBar.tsx` | 筛选栏组件（direction + payment_method） |
| `client/features/import/ImportHistory.tsx` | 导入历史 + 撤销 |
| `client/features/import/index.ts` | 导出 |
| `client/app/settings/data-import.tsx` | 移动端导入页面 |

### 7.6 后端依赖新增

| 包 | 说明 |
|------|------|
| `openpyxl` | 解析 xlsx 文件 |

## 8. 验收标准

### 8.1 插件配置

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| PC-1 | 插件声明配置 | 插件注册时可上报 `config_schema`，Server 正确存储 |
| PC-2 | 幂等更新 | 重复注册时 `config_schema` 可更新，用户已有 `config` 不被覆盖 |
| PC-3 | 配置表单渲染 | 前端根据 `config_schema` 动态渲染对应类型的表单控件 |
| PC-4 | 必填校验 | `required: true` 的字段未填写时，保存按钮不可点击 / 提交返回 422 |
| PC-5 | 类型校验 | `number` 填非数字、`select` 填无效值等，前后端均拦截 |
| PC-6 | `account_select` | 科目选择器正确展示科目树，选择后保存 `account_id` |
| PC-7 | `secret` 类型 | 保存后回显为 `••••••••`，编辑时可重新输入 |
| PC-8 | 配置状态展示 | 插件列表正确展示「待配置」/「已配置」状态 |
| PC-9 | 插件读取配置 | 插件通过 `GET /plugins/{id}` 可获取用户填写的 `config` |
| PC-10 | 向后兼容 | 无 `config_schema` 的插件不显示配置按钮，功能不受影响 |
| PC-11 | 默认值 | 用户未填写配置时，`default` 值作为初始值展示 |
| PC-12 | 桌面端一致性 | `PluginsPane` 内联配置表单与移动端 `plugin-config.tsx` 功能一致 |

### 8.2 微信账单导入

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| IM-1 | 入口可用 | 「数据导入/导出」菜单可点击，桌面端右侧面板 / 移动端跳转正常 |
| IM-2 | xlsx 解析 | 上传微信导出的 xlsx，正确跳过文件头，定位数据行，解析所有列 |
| IM-3 | 金额解析 | 正确去掉 `¥` 前缀，金额统一正数，方向由 `direction` 表达 |
| IM-4 | 中性交易导入 | 充值/提现等中性交易正常解析，`direction` 为 `"中性交易"`，导入时用户指定转出/转入两个资产科目，生成资产互转分录 |
| IM-5 | 状态过滤 | 非成功状态的交易不导入 |
| IM-6 | 预览展示 | 解析后展示全量行列表，显示收支汇总和重复数 |
| IM-7 | 去重 | `external_id` 已存在的行标记为重复，可选跳过 |
| IM-8 | 筛选功能 | 支持按 `direction`（收入/支出）和 `payment_method`（支付方式）筛选，列表实时过滤 |
| IM-9 | 行选择 | 支持全选/取消全选，支持逐行勾选/取消 |
| IM-10 | 分批科目映射 | 筛选后为当前选中的行选择费用/收入科目和支付科目（或转出/转入科目），确认导入该批次 |
| IM-11 | 分批导入 | 同一 task 支持多次 confirm，每次导入不同的行，已导入行标记为灰色 |
| IM-12 | 幂等性 | 基于 `external_id` 保证幂等：同一文件重复上传或同一 task 重复 confirm，不产生重复分录 |
| IM-13 | 批量导入 | 确认后批量创建分录，`source` 标记为 `"import"` |
| IM-14 | 导入历史 | 展示历史记录，含文件名、行数、状态（parsed/partial/imported） |
| IM-15 | 撤销导入 | 点击撤销后删除对应导入任务的所有分录 |
| IM-16 | 文件校验 | 非 xlsx / 超 10MB / 非微信账单格式，给出明确错误提示 |

## 9. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| `config_schema` 格式不规范 | 插件可能上报不合法的 schema | 后端注册时做 schema 结构校验（fields 数组、必要属性检查） |
| `secret` 类型安全性 | `config` 以明文 JSON 存储在 SQLite | 当前可接受（本地部署场景）；后续可加密存储 |
| 科目选择需要 `book_id` | `account_select` 依赖当前账本 | 配置表单打开时取 `bookStore.currentBook.id` 加载科目树 |
| 配置项变更 | 插件升级后 `config_schema` 可能变化 | 旧 `config` 中多余字段忽略，新增必填字段提示用户重新配置 |
| 无前端实时校验 | 部分校验（如 `account_select` 科目有效性）依赖后端 | 前端做基础校验，后端做完整校验，前端展示后端错误信息 |
| 微信账单格式变化 | 微信可能调整 xlsx 导出格式 | 解析器通过查找「交易时间」表头行定位，不依赖固定行号；格式异常时返回 422 |
| 大文件性能 | 上千行 xlsx 解析 | 文件大小限制 10MB；预览返回全部行（微信单次导出通常不超过数百行） |

## 10. 不包含的内容（留待后续）

- 配置项分组（group）
- 配置项联动（一个字段的值影响另一个字段的显隐）
- 配置项加密存储
- 配置变更历史
- 配置模板（从模板快速填写）
- 数据导出功能（导出为 CSV/Excel）
- 支付宝账单导入
- 通用 CSV 导入（用户自定义列映射）
- 智能科目匹配（根据交易对方/商品自动推荐科目）
- 银行流水导入
