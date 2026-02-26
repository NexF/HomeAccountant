# v0.4.2 — 记账日期精确到时分，支持日期时间选择器

> **版本：v0.4.2**
> **创建日期：2026-02-26**
> **基于版本：v0.4.1**
> **状态：规划中**
> **本版本变更：将分录日期从 `Date` 升级为 `DateTime`，前端引入原生日期时间选择器，支持用户指定精确到分钟的记账时间**

---

## 1. 背景

当前系统的分录日期字段 `entry_date` 使用 `Date` 类型（只存 `YYYY-MM-DD`），不包含时分秒信息。这带来两个问题：

### 1.1 同日记录无法按实际发生时间排序

同一天的多笔记录靠 `created_at`（录入时间戳）排序，而非实际发生时间。场景：

| 操作 | entry_date | created_at | 期望排序 | 实际排序 |
|------|-----------|------------|---------|---------|
| 早上 8:00 买早餐，当时录入 | 2026-02-26 | 08:05 | 第 1 | 第 3（最后录入的排最前） |
| 下午 15:00 加油，当时录入 | 2026-02-26 | 15:10 | 第 2 | 第 2 |
| 晚上补录昨天一笔晚餐 | 2026-02-26 | 22:00 | 第 3 | 第 1 |

用户无法控制同一天内记录的先后顺序。

### 1.2 补录场景丢失时间信息

微信账单导入（v0.4.1）已经解析出精确到秒的交易时间（如 `2026-02-24 17:26:13`），但当前只能截取日期部分存入 `entry_date`，白白丢失了时间信息。

### 1.3 前端日期输入体验差

当前日期输入使用纯 `TextInput` 文本框，用户需手动输入 `YYYY-MM-DD` 格式，没有日期校验，也没有原生日期选择器，容易输错。

## 2. 目标

| 能力 | 说明 |
|------|------|
| 日期时间存储 | `entry_date` 从 `Date` 升级为 `DateTime`，精确到分钟 |
| 日期时间选择器 | 前端使用原生日期时间选择器组件，支持同时选择日期和时间 |
| 同日精确排序 | 同一天的记录按 `entry_date` 的时间部分排序，不再依赖 `created_at` |
| 统一格式 | 所有 API 入参和出参统一使用 `YYYY-MM-DDTHH:MM:SS` 格式，不再接受纯日期 |
| 数据迁移 | 现有 `Date` 数据平滑迁移为 `DateTime`（补 `00:00:00`） |

### 设计原则

- **统一格式，不做兼容**：API 入参、出参、插件、MCP 全部统一为 `YYYY-MM-DDTHH:MM:SS`，纯日期格式 `YYYY-MM-DD` 不再接受
- **显示友好**：列表页按日期分组不变，详情和编辑页展示完整日期时间

## 3. 数据模型变更

### 3.1 `journal_entries` 表

| 字段 | 当前 | 变更后 | 说明 |
|------|------|--------|------|
| `entry_date` | `Date` | `DateTime` | 精确到秒（用户输入精确到分钟，秒默认 `00`） |

索引 `ix_journal_entries_book_date`（`book_id`, `entry_date`）保持不变，类型随字段自动变更。

### 3.2 数据迁移

编写独立迁移脚本 `server/scripts/migrate_entry_date_to_datetime.py`：

```sql
-- SQLite
ALTER TABLE journal_entries RENAME COLUMN entry_date TO entry_date_old;
ALTER TABLE journal_entries ADD COLUMN entry_date TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE journal_entries SET entry_date = entry_date_old || ' 00:00:00';
-- 重建索引
```

**迁移策略**：
- 现有 `Date` 值补 `00:00:00` 转为 `DateTime`
- 迁移脚本为幂等操作，可重复执行
- 迁移前自动备份数据库文件

## 4. API 变更

### 4.1 入参格式

所有接受 `entry_date` 的端点（创建、更新、批量导入）**统一要求** `datetime` 格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| ISO 8601 | `"2026-02-26T14:30:00"` | 唯一接受的格式 |
| 纯日期 | `"2026-02-26"` | **不再接受，返回 422** |

Pydantic schema 直接使用 `datetime` 类型，无需自定义验证器：

```python
from datetime import datetime

class EntryCreateRequest(BaseModel):
    entry_date: datetime  # 必须传 ISO 8601 datetime 格式
```

### 4.2 出参格式

所有返回 `entry_date` 的端点统一返回 ISO 8601 格式：

```json
{
  "entry_date": "2026-02-26T14:30:00"
}
```

### 4.3 列表查询参数

`GET /books/{book_id}/entries` 的 `start_date` / `end_date` 参数**保持 `date` 类型**不变（用户按天筛选），后端查询逻辑调整：

| 参数 | 当前查询 | 变更后 |
|------|---------|--------|
| `start_date=2026-02-26` | `entry_date >= '2026-02-26'` | `entry_date >= '2026-02-26 00:00:00'` |
| `end_date=2026-02-26` | `entry_date <= '2026-02-26'` | `entry_date < '2026-02-27 00:00:00'` |

### 4.4 排序变更

| 当前 | 变更后 |
|------|--------|
| `ORDER BY entry_date DESC, created_at DESC` | `ORDER BY entry_date DESC` |

`entry_date` 已包含时间信息，不再需要 `created_at` 作为第二排序键。

### 4.5 报表接口

报表接口（`/reports/balance-sheet`、`/reports/income-statement` 等）的 `as_of_date`、`start`、`end` 参数保持 `date` 类型，后端查询逻辑同 4.3 调整边界处理。

## 5. 前端变更

### 5.1 日期时间选择器组件

新增通用组件 `DateTimePicker`，封装跨平台的日期时间选择能力：

| 平台 | 实现方式 |
|------|---------|
| iOS | `@react-native-community/datetimepicker`（原生 DateTimePicker） |
| Android | `@react-native-community/datetimepicker`（原生 DateTimePicker） |
| Web | HTML `<input type="datetime-local">` |

**组件 API**：

```tsx
interface DateTimePickerProps {
  value: Date;                    // 当前值
  onChange: (date: Date) => void; // 值变更回调
  mode?: 'date' | 'datetime';    // 模式，默认 'datetime'
  minimumDate?: Date;             // 可选最小日期
  maximumDate?: Date;             // 可选最大日期
}
```

**交互设计**：

```
┌─────────────────────────────────────────────────┐
│  日期                                            │
│  ┌───────────────────────────────────────────┐  │
│  │ 2026-02-26  14:30                     📅  │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  点击后弹出原生日期时间选择器：                    │
│  ┌───────────────────────────────────────────┐  │
│  │        2026 年 2 月 26 日                 │  │
│  │   ┌─────┐  ┌─────┐  ┌─────┐             │  │
│  │   │  26 │  │  14 │  │  30 │             │  │
│  │   │  27 │  │  15 │  │  31 │             │  │
│  │   │  28 │  │  16 │  │  32 │             │  │
│  │   └─────┘  └─────┘  └─────┘             │  │
│  │    日期       时        分                │  │
│  │                                           │  │
│  │              [确定]                        │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 5.2 新建记账页 — `app/entry/new.tsx`

| 变更项 | 当前 | 变更后 |
|--------|------|--------|
| 日期状态 | `string`（`"YYYY-MM-DD"`） | `Date` 对象 |
| 默认值 | `todayStr()` → `"2026-02-26"` | `new Date()` → 当前日期时间 |
| 输入控件 | `TextInput` + `placeholder="YYYY-MM-DD"` | `DateTimePicker` 组件 |
| 提交格式 | `"2026-02-26"` | `"2026-02-26T14:30:00"`（ISO 8601） |

### 5.3 编辑记账页 — `app/entry/[id].tsx`

| 变更项 | 当前 | 变更后 |
|--------|------|--------|
| 日期回填 | `setEntryDate(data.entry_date)` → `"2026-02-26"` | `setEntryDate(new Date(data.entry_date))` |
| 日期显示 | `<Text>{entry.entry_date}</Text>` → `"2026-02-26"` | 格式化为 `"2026-02-26 14:30"` |

### 5.4 账目列表页 — `app/(tabs)/ledger.tsx`

**按日期分组逻辑调整**：

```typescript
// 当前：直接用 entry_date 字符串分组
const d = e.entry_date;  // "2026-02-26"

// 变更后：截取日期部分分组
const d = e.entry_date.slice(0, 10);  // "2026-02-26T14:30:00" → "2026-02-26"
```

分组标题显示不变（仍为日期），组内记录按时间倒序排列（由后端排序保证）。

**列表项时间展示**（可选增强）：

```
┌─────────────────────────────────────────────────┐
│  2026-02-26 周四                                 │  ← 日期分组标题
├─────────────────────────────────────────────────┤
│  14:30  加油        中石化     ¥-300.00          │  ← 新增时间列
│  08:05  早餐        包子铺     ¥-12.00           │
│  00:00  补录        昨日晚餐   ¥-45.00           │  ← 旧数据显示 00:00
└─────────────────────────────────────────────────┘
```

### 5.5 其他页面适配

| 页面 / 组件 | 变更 |
|-------------|------|
| `features/entry/EntryCard.tsx` | 如需显示时间，从 `entry_date` 提取 `HH:mm` 展示 |
| `features/sync/ReconcileCard.tsx` | 日期显示截取前 10 位或格式化 |
| `services/entryService.ts` | `entry_date` 类型注释更新为 `// ISO 8601: YYYY-MM-DDTHH:mm:ss` |
| `services/reportService.ts` | `RecentEntryItem.entry_date` 注释更新 |
| `services/syncService.ts` | `PendingReconcileItem.entry_date` 注释更新 |
| `app/reports/trends.tsx` | 如有日期显示，截取日期部分 |

## 6. 后端各层适配

### 6.1 Service 层 — `entry_service.py`

| 函数 | 变更 |
|------|------|
| `create_expense` / `create_income` / `create_transfer` 等 7 个创建函数 | 参数类型 `date` → `datetime` |
| `list_entries` | `start_date`/`end_date` 保持 `date`，查询改为 `>= start_date` 和 `< end_date + 1 day` |
| 排序 | 移除 `created_at.desc()` 二级排序 |

### 6.2 其他 Service

| 文件 | 变更 |
|------|------|
| `report_service.py` | `as_of_date` 日期比较改为 `entry_date < as_of_date + 1 day`；`isoformat()` 输出保持不变（`datetime.isoformat()` 自动含时间） |
| `reconciliation_service.py` | 同上模式处理日期边界；创建调节分录时用 `datetime` |
| `depreciation_service.py` | `date.today()` → `datetime.now()`；处置日期转 `datetime` |
| `import_service.py` | 微信交易时间直接解析为 `datetime`（不再截取日期），完整保留 `2026-02-24 17:26:13` |
| `batch_entry_service.py` | 跟随 Schema 类型变更，无需额外改动 |

### 6.3 Parser

| 文件 | 变更 |
|------|------|
| `parsers/wechat.py` | `date_str = dt.strftime("%Y-%m-%d")` → `date_str = dt.strftime("%Y-%m-%dT%H:%M:%S")`，保留原始交易时间 |

### 6.4 插件/MCP

| 文件 | 变更 |
|------|------|
| `plugins/bank_monitor/plugin.py` | `entry_date = record.get("msg_time", "")[:10]` → 保留完整时间，输出 `YYYY-MM-DDTHH:MM:SS` 格式 |
| `server/mcp_server/tools/entries.py` | 注释及入参格式更新为 `entry_date: 日期时间 (YYYY-MM-DDTHH:mm:ss)`，不再接受纯日期 |

## 7. 依赖变更

### 7.1 前端新增依赖

| 包 | 说明 |
|----|------|
| `@react-native-community/datetimepicker` | React Native 原生日期时间选择器 |

### 7.2 后端

无新增依赖。

## 8. 涉及文件变更

### 8.1 后端修改

| # | 文件 | 变更 |
|---|------|------|
| 1 | `server/app/models/journal.py` | `entry_date` 字段类型 `Date` → `DateTime`，Python 类型 `date` → `datetime` |
| 2 | `server/app/schemas/entry.py` | 3 处类型 `date` → `datetime`，移除 `date` 导入 |
| 3 | `server/app/services/entry_service.py` | 7 个函数签名 + 查询边界 + 排序逻辑 |
| 4 | `server/app/services/report_service.py` | 日期比较边界处理 |
| 5 | `server/app/services/reconciliation_service.py` | 日期比较 + 分录创建 |
| 6 | `server/app/services/depreciation_service.py` | `date.today()` → `datetime.now()` |
| 7 | `server/app/services/import_service.py` | 日期解析保留完整时间 |
| 8 | `server/app/services/batch_entry_service.py` | 跟随类型变更 |
| 9 | `server/app/routers/entries.py` | 查询参数边界逻辑 |
| 10 | `server/app/routers/reports.py` | 查询参数边界逻辑 |
| 11 | `server/app/parsers/wechat.py` | 输出完整时间而非截取日期 |
| 12 | `server/mcp_server/tools/entries.py` | 入参格式及注释更新，仅接受 `datetime` |
| 13 | `plugins/bank_monitor/plugin.py` | 输出完整 `datetime` 格式 |

### 8.2 后端新增

| # | 文件 | 说明 |
|---|------|------|
| 1 | `server/scripts/migrate_entry_date_to_datetime.py` | 数据库迁移脚本 |

### 8.3 前端修改

| # | 文件 | 变更 |
|---|------|------|
| 1 | `client/app/entry/new.tsx` | `TextInput` → `DateTimePicker`，状态类型 `string` → `Date`，提交格式 ISO 8601 |
| 2 | `client/app/entry/[id].tsx` | 日期回填 + 显示格式化 |
| 3 | `client/app/(tabs)/ledger.tsx` | `groupByDate` 截取日期部分分组，列表项可选展示时间 |
| 4 | `client/services/entryService.ts` | 类型注释更新 |
| 5 | `client/services/reportService.ts` | 类型注释更新 |
| 6 | `client/services/syncService.ts` | 类型注释更新 |
| 7 | `client/features/entry/EntryCard.tsx` | 可选增加时间显示 |
| 8 | `client/features/sync/ReconcileCard.tsx` | 日期显示格式化 |

### 8.4 前端新增

| # | 文件 | 说明 |
|---|------|------|
| 1 | `client/components/DateTimePicker.tsx` | 跨平台日期时间选择器组件 |

### 8.5 测试修改

| # | 文件 | 预估改动量 |
|---|------|-----------|
| 1 | `server/tests/test_entries.py` | 24 处 `entry_date` 格式更新 |
| 2 | `server/tests/test_batch_entries.py` | 9 处 |
| 3 | `server/tests/test_entry_convert.py` | 6 处 |
| 4 | `server/tests/test_e2e_api_key_plugin_flow.py` | 5 处 |
| 5 | `server/tests/test_mcp_e2e.py` | 4 处 |
| 6 | `server/tests/test_budget_api.py` | 2 处 |
| 7 | `server/tests/test_reports.py` | 2 处 |
| 8 | `server/tests/test_leaf_account.py` | 2 处 |
| 9 | `server/tests/test_sync.py` | 1 处 |

> 所有测试的 `entry_date` 必须更新为 `datetime` 格式（如 `"2025-06-15T10:30:00"`），纯日期格式不再被接受。

## 9. 验收标准

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| DT-1 | 数据库迁移 | 执行迁移脚本后，现有 `entry_date` 数据补 `00:00:00`，查询正常 |
| DT-2 | 纯日期拒绝 | API 传入 `"2026-02-26"`（纯日期）返回 422 |
| DT-3 | 日期时间入参 | API 传入 `"2026-02-26T14:30:00"` 精确存储，创建成功 |
| DT-4 | 日期时间选择器（iOS） | 新建记账页点击日期字段弹出原生日期时间选择器，可选择日期和时间 |
| DT-5 | 日期时间选择器（Android） | 同 DT-4 |
| DT-6 | 日期时间选择器（Web） | 使用 `datetime-local` 输入框，交互正常 |
| DT-7 | 默认值 | 新建记账时日期时间默认为当前时刻 |
| DT-8 | 编辑回填 | 编辑记账时正确回填已有的日期时间 |
| DT-9 | 同日排序 | 同一天的记录按 `entry_date` 时间部分倒序排列 |
| DT-10 | 列表分组 | 列表页按日期（不含时间）正确分组，组内按时间倒序 |
| DT-11 | 列表时间显示 | 列表每条记录显示 `HH:mm` 时间 |
| DT-12 | 报表边界 | `end_date=2026-02-26` 的报表查询包含当天所有时间的记录 |
| DT-13 | 微信导入保留时间 | 微信账单导入后，分录 `entry_date` 保留原始交易时间（如 `17:26:13`） |
| DT-14 | 插件适配 | 插件 `entry_date` 输出统一为 `YYYY-MM-DDTHH:MM:SS` 格式 |
| DT-15 | MCP 适配 | MCP 工具 `entry_date` 入参统一为 `datetime` 格式 |
| DT-16 | 全量测试通过 | 465+ 测试用例全部通过 |

## 10. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| SQLite 时间精度 | SQLite 的 `TIMESTAMP` 存储为文本，精度取决于格式 | 统一使用 `YYYY-MM-DD HH:MM:SS` 格式 |
| 时区 | 服务端存储 naive datetime（无时区），与客户端本地时间一致 | 当前为单用户本地部署场景，暂不处理时区；后续多用户版本再引入 UTC 存储 + 时区转换 |
| 数据迁移不可逆 | `Date` → `DateTime` 后无法无损回退 | 迁移脚本自动备份数据库文件 |
| 旧数据显示 `00:00` | 迁移前的记录时间为 `00:00`，列表显示可能困惑 | 前端对 `00:00` 特殊处理：不显示时间或显示为 `--:--` |
| `datetimepicker` 兼容性 | `@react-native-community/datetimepicker` 在不同 Android 版本表现可能不同 | 测试覆盖 Android 10+；降级方案为手动输入 |
| 测试改动量 | 9 个测试文件约 55 处需适配 | 所有测试的 `entry_date` 统一改为 `datetime` 格式 |

## 11. 不包含的内容（留待后续）

- 时区支持（UTC 存储 + 前端时区转换）
- 日历视图（按月展示记账分布）
- 日期范围快捷选择（本周/本月/自定义范围）
- 重复记账（定时自动创建分录）
