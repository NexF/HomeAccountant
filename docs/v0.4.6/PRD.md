# v0.4.6 — 插件多账本同步

> **版本：v0.4.6**
> **创建日期：2026-03-02**
> **基于版本：v0.4.1（插件配置）**
> **状态：规划中**
> **本版本变更：将插件配置从"单账本"升级为"多账本"模式，一个插件实例可同时向多个账本同步数据**

---

## 1. 背景

### 1.1 当前限制

v0.4.1 引入了插件动态配置能力。插件通过 `config_schema` 声明配置结构，其中 `book_select` 类型字段让用户选择一个目标账本，`account_select` 通过 `depends_on` 级联依赖该 `book_select` 字段来选择科目。

当前所有三个插件都使用了这套机制：

| 插件 | `book_select` 字段 | 依赖的 `account_select` 字段 |
|------|--------------------|-----------------------------|
| 招行储蓄卡同步 (`wx_bank_monitor`) | `target_book` | `deposit_account_id`、`default_expense_id`、`default_income_id` |
| 长桥证券同步 (`longport_monitor`) | `target_book` | `securities_account_id` |
| 东方财富同步 (`eastmoney_monitor`) | `target_book` | `securities_account_id` |

**问题**：`book_select` 只能选择**一个账本**。实际场景中，用户可能需要同一个插件同时向多个账本同步数据：

| 场景 | 说明 |
|------|------|
| 家庭 + 个人账本 | 用户有一张银行卡，既想同步到"个人账本"也想同步到"家庭账本" |
| 投资分账 | 同一个证券账户的交易，既记入"个人投资账本"也同步到"家庭总账" |
| 夫妻共用 | 一张招行卡在丈夫个人账本和家庭共同账本中都需要有同步数据 |

当前要实现上述场景，用户只能**注册多个插件实例**（同一个脚本注册两次，分别配置不同账本），管理成本高、配置冗余。

### 1.2 设计目标

将 `book_select` 升级为支持多账本选择，一个插件实例可配置**多组**「账本 + 科目」映射，每组独立。插件运行时读取配置后，向所有配置的账本推送数据。

## 2. 目标

| 能力 | 说明 |
|------|------|
| 多账本配置 | `book_select` 支持选择多个账本，每个账本下独立配置关联科目 |
| 插件端透明 | 插件通过 `GET /plugins/{id}` 读取配置，新格式清晰易解析 |
| 前端动态渲染 | 配置表单支持「添加账本」「删除账本」操作，每组账本内渲染其依赖的科目字段 |

### 设计原则

- **最小改动**：复用 v0.4.1 的 `config_schema` 机制，仅扩展 `book_select` 语义，不引入新的字段类型
- **Server 无插件逻辑**：Server 仍只负责存储和校验 JSON，不理解具体插件业务

## 3. 方案设计

### 3.1 核心思路：`multi: true`

在 `config_schema` 中为 `book_select` 字段新增 `multi: true` 属性，表示该字段支持选择多个账本。开启后：

- `config` 中该字段的值从**单个字符串**变为**字符串数组**
- 所有通过 `depends_on` 依赖该 `book_select` 的 `account_select` 字段，其值也从**单个字符串**变为**对象**（以 `book_id` 为 key）

### 3.2 `config_schema` 变更

`book_select` 字段新增可选属性 `multi`：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `multi` | boolean | ❌ | 默认 `false`。为 `true` 时允许选择多个账本 |

示例（长桥证券插件升级后的 schema）：

```json
{
  "fields": [
    {
      "key": "target_book",
      "label": "同步账本",
      "type": "book_select",
      "required": true,
      "multi": true,
      "description": "选择需要同步的账本（支持多选）"
    },
    {
      "key": "securities_account_id",
      "label": "证券资产科目",
      "type": "account_select",
      "required": true,
      "depends_on": "target_book",
      "description": "每个账本中对应的证券资产科目"
    },
    {
      "key": "lp_app_key",
      "label": "App Key",
      "type": "string",
      "required": true
    },
    {
      "key": "lp_app_secret",
      "label": "App Secret",
      "type": "secret",
      "required": true
    },
    {
      "key": "lp_access_token",
      "label": "Access Token",
      "type": "secret",
      "required": true
    },
    {
      "key": "sync_time",
      "label": "同步时间",
      "type": "string",
      "required": false,
      "default": "16:30"
    }
  ]
}
```

### 3.3 `config` 值格式

#### 3.3.1 单账本模式（`multi` 未设置或为 `false`，现有行为不变）

```json
{
  "target_book": "book-uuid-1",
  "securities_account_id": "account-uuid-1",
  "lp_app_key": "xxx",
  "lp_app_secret": "***",
  "lp_access_token": "***",
  "sync_time": "16:30"
}
```

#### 3.3.2 多账本模式（`multi: true`）

```json
{
  "target_book": ["book-uuid-1", "book-uuid-2"],
  "securities_account_id": {
    "book-uuid-1": "account-uuid-A",
    "book-uuid-2": "account-uuid-B"
  },
  "lp_app_key": "xxx",
  "lp_app_secret": "***",
  "lp_access_token": "***",
  "sync_time": "16:30"
}
```

**规则**：

| 字段 | 单账本值 | 多账本值 | 说明 |
|------|---------|---------|------|
| `book_select` (`multi: true`) | `"book-uuid"` | `["book-uuid-1", "book-uuid-2"]` | 从字符串变为字符串数组 |
| `account_select` (`depends_on` 指向 multi book_select) | `"account-uuid"` | `{"book-uuid-1": "acct-1", "book-uuid-2": "acct-2"}` | 从字符串变为 `{book_id: account_id}` 映射对象 |
| 其他类型字段 | 不变 | 不变 | `string`/`number`/`boolean`/`select`/`secret` 不受影响 |

## 4. API 变更

### 4.1 `GET /plugins/{plugin_id}` — 响应变更

`config` 字段中 `book_select`（`multi: true`）和其依赖的 `account_select` 使用新格式：

```json
{
  "id": "uuid",
  "name": "长桥证券同步",
  "config_schema": {
    "fields": [
      { "key": "target_book", "label": "同步账本", "type": "book_select", "required": true, "multi": true },
      { "key": "securities_account_id", "label": "证券资产科目", "type": "account_select", "required": true, "depends_on": "target_book" }
    ]
  },
  "config": {
    "target_book": ["book-uuid-1", "book-uuid-2"],
    "securities_account_id": {
      "book-uuid-1": "account-uuid-A",
      "book-uuid-2": "account-uuid-B"
    }
  }
}
```

### 4.2 `PUT /plugins/{plugin_id}/config` — 请求体变更

请求体中 `config` 支持新格式值：

```json
{
  "config": {
    "target_book": ["book-uuid-1", "book-uuid-2"],
    "securities_account_id": {
      "book-uuid-1": "account-uuid-A",
      "book-uuid-2": "account-uuid-B"
    },
    "lp_app_key": "xxx",
    "lp_app_secret": "yyy",
    "lp_access_token": "zzz",
    "sync_time": "16:30"
  }
}
```

### 4.3 校验规则变更

在 `update_plugin_config` 中扩展校验逻辑：

| 规则 | 单账本模式 | 多账本模式 (`multi: true`) |
|------|-----------|--------------------------|
| `book_select` 值类型 | `string` | `list[string]`，不能为空列表 |
| `book_select` 权限校验 | 校验单个 book_id | 逐一校验列表中每个 book_id |
| `book_select` 去重 | N/A | 数组内不允许重复 book_id |
| `account_select` 值类型 | `string` | `dict[str, str]`，key 为 `book_id` |
| `account_select` 完整性 | 校验单个 account_id | 每个已选 book_id 必须有对应的 account_id（当 `required: true` 时） |
| `account_select` 归属校验 | account_id 属于所选 book | 每个 account_id 属于其对应的 book_id |

**错误响应示例**：

```json
{
  "detail": {
    "errors": [
      { "field": "target_book", "message": "账本 book-uuid-3 不存在" },
      { "field": "securities_account_id", "message": "账本 book-uuid-2 的科目未配置" },
      { "field": "securities_account_id", "message": "科目 acct-xxx 不属于账本 book-uuid-1" }
    ]
  }
}
```

### 4.4 `GET /plugins` — 列表响应变更

`is_configured` 计算逻辑更新：

| 模式 | `is_configured` = true 条件 |
|------|---------------------------|
| 单账本 | 所有 `required` 字段已填写（现有逻辑） |
| 多账本 | 所有 `required` 字段已填写，且 `book_select` 数组非空，且每个 book 的 `account_select` 都已填写 |

### 4.5 `POST /plugins` — 注册接口

无变更。`config_schema` 中支持 `multi: true` 属性，Server 存储时不做额外处理。

## 5. 前端变更

### 5.1 配置表单 — 多账本模式

当 `book_select` 字段包含 `multi: true` 时，表单渲染方式从单选变为分组式多账本配置：

```
┌────────────────────────────────────────────────┐
│  ▼ 插件配置                                     │
│                                                │
│  同步账本 *                                     │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  📖 个人账本                     [✕]     │  │
│  │                                          │  │
│  │  证券资产科目 *                           │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │ 长桥证券 (1101-01)          ▾    │    │  │
│  │  └──────────────────────────────────┘    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  📖 家庭账本                     [✕]     │  │
│  │                                          │  │
│  │  证券资产科目 *                           │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │ 长桥证券 (1101-01)          ▾    │    │  │
│  │  └──────────────────────────────────┘    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [+ 添加账本]                                   │
│                                                │
│  ─── 其他配置 ───                               │
│                                                │
│  App Key *                                     │
│  ┌──────────────────────────────────────────┐  │
│  │ xxx                                      │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  App Secret *                                  │
│  ┌──────────────────────────────────────────┐  │
│  │ ••••••••                                 │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  同步时间                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ 16:30                                    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│                            [取消]  [保存配置]   │
└────────────────────────────────────────────────┘
```

### 5.2 表单渲染规则（多账本模式）

| 操作 | 行为 |
|------|------|
| 初始状态 | 如已有配置，按 `target_book` 数组渲染已有分组；无配置时显示空状态 + 「添加账本」 |
| 添加账本 | 点击「+ 添加账本」，弹出账本选择器（排除已选的账本），选择后新增一个分组 |
| 删除账本 | 点击分组右上角 `[✕]`，移除该分组（`target_book` 数组移除对应 book_id，`account_select` 映射删除对应 key） |
| 分组内科目选择 | 每个分组内独立渲染 `depends_on` 该 `book_select` 的 `account_select` 字段，科目列表根据该分组的 `book_id` 加载 |
| 至少一个账本 | `required: true` 时，最后一个分组不允许删除（`[✕]` 按钮禁用） |
| 账本不可重复 | 添加账本选择器中不显示已选账本 |
| 非 multi 字段 | 不在分组内，渲染在分组区域下方（如 `lp_app_key`、`sync_time`），行为不变 |

### 5.3 分组卡片样式

| 元素 | 样式 |
|------|------|
| 分组容器 | `borderWidth: 1`, `borderColor: colors.border`, `borderRadius: 10`, `padding: 16`, `marginBottom: 12` |
| 账本名称 | `fontSize: 15`, `fontWeight: 600`, `color: colors.text` |
| 账本图标 | `📖` 或 `FontAwesome5 book`，`marginRight: 8` |
| 删除按钮 | 右上角 `✕`，`color: colors.textSecondary`，hover 变红 |
| 「添加账本」按钮 | `color: Colors.primary`, `fontSize: 14`，左对齐，带 `+` 图标 |

### 5.4 移动端配置页面

移动端 `plugin-config.tsx` 同样适配多账本模式，分组卡片竖向排列：

```
┌─────────────────────────────────────────────┐
│  ← 返回          插件配置                     │
├─────────────────────────────────────────────┤
│                                             │
│  长桥证券同步                                │
│  自动同步长桥证券持仓和余额                   │
│                                             │
│  ─── 同步账本 * ───                          │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📖 个人账本                  [✕]   │    │
│  │                                     │    │
│  │  证券资产科目 *                      │    │
│  │  [长桥证券 (1101-01)           ▾]   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📖 家庭账本                  [✕]   │    │
│  │                                     │    │
│  │  证券资产科目 *                      │    │
│  │  [长桥证券 (1101-01)           ▾]   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [+ 添加账本]                                │
│                                             │
│  ─── 其他配置 ───                            │
│                                             │
│  App Key *                                  │
│  [xxx                              ]        │
│                                             │
│  App Secret *                               │
│  [••••••••                         ]        │
│                                             │
│  同步时间                                    │
│  [16:30                            ]        │
│                                             │
│  [        保存配置        ]                  │
│                                             │
└─────────────────────────────────────────────┘
```

### 5.5 插件卡片配置状态

多账本模式下，配置状态展示增加账本数量信息：

| `has_config` | `is_configured` | 展示 |
|---|---|---|
| `true`（multi） | `false` | ⚠️ 待配置（橙色） |
| `true`（multi） | `true` | ✅ 已配置 · 2 个账本（绿色） |

账本数量从 `config` 中 `book_select` 数组长度获取。

### 5.6 添加账本选择器

点击「+ 添加账本」后，在按钮下方内联展开可选账本列表（横向标签按钮组，复用 `book_select` 单选模式的渲染样式），过滤已选账本。桌面端与移动端交互一致。

选择后自动创建新分组，分组内 `account_select` 字段为空，等待用户配置。可选账本列表随即收起。

## 6. 数据模型变更

### 6.1 `plugins` 表

**无表结构变更**。`config_schema` 和 `config` 仍为 JSON (TEXT) 字段，格式变化仅体现在 JSON 内容层面。

### 6.2 `config_schema` 字段类型扩展

`book_select` 类型新增可选属性：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `multi` | boolean | ❌ | 默认 `false`。为 `true` 时允许选择多个账本，`config` 中值变为数组 |

其他字段类型不变。

## 7. 插件端适配

### 7.1 插件 `CONFIG_SCHEMA` 升级

各插件只需在 `book_select` 字段中添加 `"multi": true`：

```python
# 以 longport_monitor 为例
CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "同步账本",
            "type": "book_select",
            "required": True,
            "multi": True,                           # ← 新增
            "description": "选择需要同步的账本（支持多选）",
        },
        {
            "key": "securities_account_id",
            "label": "证券资产科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",             # 不变
            "description": "每个账本中对应的证券资产科目",
        },
        # ... 其他字段不变
    ]
}
```

### 7.2 插件读取配置变更

插件通过 `GET /plugins/{id}` 读取 `config` 后，需适配新格式：

```python
# 旧方式（单账本）
config = plugin_info["config"]
book_id = config["target_book"]           # str
account_id = config["securities_account_id"]  # str
sync_to_book(book_id, account_id)

# 新方式（多账本）
config = plugin_info["config"]
book_ids = config["target_book"]          # list[str]
account_map = config["securities_account_id"]  # dict[str, str]
for book_id in book_ids:
    account_id = account_map[book_id]
    sync_to_book(book_id, account_id)
```

### 7.3 插件批量记账适配

插件当前通过 `POST /plugins/{plugin_id}/entries/batch` 推送数据，请求体中 `book_id` 为必填字段。多账本模式下，插件需要**为每个账本分别调用**批量记账接口：

```python
for book_id in book_ids:
    account_id = account_map[book_id]
    entries = build_entries(book_id, account_id, raw_data)
    api.post(f"/plugins/{plugin_id}/entries/batch", {
        "book_id": book_id,
        "entries": entries,
    })
```

> 批量记账 API 本身不变，插件端循环调用即可。

## 8. 涉及文件变更

### 8.1 后端修改

| 文件 | 变更 |
|------|------|
| `server/app/schemas/plugin.py` | `is_configured` 计算逻辑更新，支持多账本模式 |
| `server/app/services/plugin_service.py` | `update_plugin_config` 中 `book_select` 和 `account_select` 校验逻辑扩展：支持数组值和对象值的校验 |

### 8.2 前端修改

| 文件 | 变更 |
|------|------|
| `client/services/pluginService.ts` | `ConfigField` 类型新增 `multi?: boolean` |
| `client/features/plugin/PluginConfigForm.tsx` | 核心改动：当 `book_select.multi` 时，渲染分组式多账本表单（添加/删除分组、分组内科目选择） |
| `client/features/plugin/PluginsPane.tsx` | 配置状态展示增加账本数量 |
| `client/app/settings/plugin-config.tsx` | 移动端配置页同步适配多账本渲染 |

### 8.3 插件端修改

| 文件 | 变更 |
|------|------|
| `plugins/longport_monitor/plugin.py` | `CONFIG_SCHEMA` 中 `target_book` 增加 `"multi": True`；同步逻辑循环所有账本 |
| `plugins/eastmoney_monitor/plugin.py` | 同上 |
| `plugins/wx_bank_monitor/plugin.py` | 同上 |

## 9. 验收标准

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| MB-1 | Schema 声明 | 插件注册时 `book_select` 字段可包含 `multi: true`，Server 正确存储 |
| MB-2 | 多账本选择 | 前端配置表单支持添加多个账本分组，每个分组可独立选择账本 |
| MB-3 | 分组内科目选择 | 每个账本分组内，`account_select` 字段根据该分组的 `book_id` 加载对应科目树 |
| MB-4 | 账本不可重复 | 添加账本时不显示已选账本；提交时后端校验数组内无重复 |
| MB-5 | 删除分组 | 可删除账本分组，`required: true` 时至少保留一个 |
| MB-6 | 保存校验 | 后端逐一校验每个 `book_id` 的权限、每个 `account_id` 的归属和存在性 |
| MB-7 | 插件读取配置 | 插件通过 `GET /plugins/{id}` 获取的 `config` 格式正确（数组 + 映射对象） |
| MB-8 | 配置状态展示 | 多账本模式下，插件卡片展示「已配置 · N 个账本」 |
| MB-9 | 单账本兼容 | `multi` 未设置或为 `false` 的 `book_select` 行为完全不变 |
| MB-10 | `canSave` 计算 | 多账本模式下，所有分组的 `required` 科目字段均已填写时，保存按钮才可用 |
| MB-11 | 桌面端一致性 | `PluginConfigForm` 内联多账本表单与移动端 `plugin-config.tsx` 功能一致 |
| MB-12 | 插件批量记账 | 插件端为每个已配置的账本分别推送数据，数据正确写入对应账本 |

## 10. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| 账本较多时 UI 拥挤 | 用户添加 5+ 个账本分组，表单过长 | 分组可折叠（显示账本名 + 配置状态，点击展开详情）；实际场景中 2-3 个账本为主 |
| 插件运行时间增加 | 多账本意味着多次 API 调用 | 插件可并发推送；单次同步数据量通常不大 |
| `account_select` 映射对象 key 一致性 | `account_select` 对象的 key 必须与 `book_select` 数组元素一一对应 | 后端校验：`account_select` 的 key 集合必须是 `book_select` 数组的子集（`required` 时为全集） |

## 11. 不包含的内容（留待后续）

- 按账本维度的独立同步开关（暂停某个账本的同步而不删除配置）
- 账本级别的同步日志/状态追踪
- 多账本间的数据去重策略（当前由 `external_id` 在各账本内独立去重）
- 批量记账 API 支持一次传入多个 `book_id`（当前需分次调用）
- 拖拽排序账本分组顺序
