# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.2**
> **创建日期：2026-02-26**
> **基于版本：v0.4.1**
> **状态：规划中**
> **本版本变更：`entry_date` 从 `Date` 升级为 `DateTime`；前端引入跨平台日期时间选择器；统一 API 格式为 ISO 8601 datetime**

---

## 1. 技术架构概述

v0.4.2 是一次**纵向贯穿**的变更，从数据库模型 → Schema → Service → Router → 前端 UI 全链路修改 `entry_date` 字段类型。

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：Python FastAPI + SQLAlchemy (async) + SQLite (aiosqlite)

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **数据模型** | `server/app/models/journal.py` | 修改 | `entry_date` 类型 `Date` → `DateTime` |
| **Schema** | `server/app/schemas/entry.py` | 修改 | 3 处 `date` → `datetime` |
| **Service** | `server/app/services/entry_service.py` | 修改 | 7 个函数签名 + 查询边界 + 排序 |
| **Service** | `server/app/services/report_service.py` | 修改 | 日期比较边界 + 序列化 |
| **Service** | `server/app/services/reconciliation_service.py` | 修改 | 日期比较 + 分录创建 |
| **Service** | `server/app/services/depreciation_service.py` | 修改 | `date.today()` → `datetime.now()` |
| **Service** | `server/app/services/import_service.py` | 修改 | 日期解析保留完整时间 |
| **Service** | `server/app/services/batch_entry_service.py` | 修改 | 随 schema 类型变更 |
| **Router** | `server/app/routers/entries.py` | 修改 | 查询参数边界逻辑 |
| **Router** | `server/app/routers/reports.py` | 修改 | 查询参数边界逻辑 |
| **解析器** | `server/app/parsers/wechat.py` | 修改 | 输出完整 datetime 而非截断日期 |
| **MCP** | `server/mcp_server/tools/entries.py` | 修改 | 入参格式及文档更新 |
| **插件** | `plugins/bank_monitor/plugin.py` | 修改 | 输出完整 datetime |
| **迁移** | `server/app/database.py` | 修改 | 新增 `_migrate_entry_date_to_datetime` |
| **前端组件** | `client/components/DateTimePicker.tsx` | 新增 | 跨平台日期时间选择器 |
| **前端页面** | `client/app/entry/new.tsx` | 修改 | TextInput → DateTimePicker |
| **前端页面** | `client/app/entry/[id].tsx` | 修改 | 日期回填 + 格式化显示 |
| **前端页面** | `client/app/(tabs)/ledger.tsx` | 修改 | 分组逻辑 + 时间列展示 |
| **前端 Service** | `client/services/entryService.ts` | 修改 | 类型注释更新 |
| **前端 Service** | `client/services/reportService.ts` | 修改 | 类型注释更新 |
| **前端 Service** | `client/services/syncService.ts` | 修改 | 类型注释更新 |
| **前端组件** | `client/features/sync/ReconcileCard.tsx` | 修改 | 日期格式化 |

---

## 2. 数据模型实现

### 2.1 `journal_entries.entry_date` — 类型变更

**文件：`server/app/models/journal.py`**

当前代码（L2、L5、L30）：

```python
import uuid
from datetime import datetime, date                    # L2

from sqlalchemy import (
    String, DateTime, Date, ForeignKey, Boolean, Text,  # L5 — 含 Date
    Numeric, JSON, Enum as SAEnum, Index,
)

# L30
entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
```

变更后：

```python
import uuid
from datetime import datetime                          # 移除 date 导入

from sqlalchemy import (
    String, DateTime, ForeignKey, Boolean, Text,       # 移除 Date
    Numeric, JSON, Enum as SAEnum, Index,
)

# L30
entry_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
```

> **索引影响**：复合索引 `ix_journal_entries_book_date`（L16）和单列索引随字段类型自动变更，SQLite 中 TIMESTAMP 按文本排序，`YYYY-MM-DD HH:MM:SS` 格式天然支持正确排序。

### 2.2 数据库迁移

**文件：`server/app/database.py`** — 在 `init_db()` 中追加迁移函数：

```python
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_budgets(conn)
        await _migrate_journal_external_id(conn)
        await _migrate_users_admin(conn)
        await _migrate_plugin_config(conn)
        # v0.4.2
        await _migrate_entry_date_to_datetime(conn)


async def _migrate_entry_date_to_datetime(conn):
    """将 entry_date 从 DATE 迁移为 TIMESTAMP（幂等）。

    SQLite 不支持 ALTER COLUMN，需要重建列。
    迁移策略：
      1. 检查当前列是否已经包含时间信息（抽样检查）
      2. 若为纯日期格式，添加新列 → 数据迁移 → 删除旧列 → 重命名
      3. 重建索引
    """
    from sqlalchemy import text
    import shutil
    import os

    # 幂等检查：抽样查看是否已含时间
    sample = await conn.execute(
        text("SELECT entry_date FROM journal_entries LIMIT 1")
    )
    row = sample.fetchone()
    if row is None:
        return  # 空表，无需迁移
    if row[0] and "T" in str(row[0]) or " " in str(row[0]) and ":" in str(row[0]):
        return  # 已包含时间信息，无需迁移

    # 备份数据库文件
    db_path = str(engine.url).replace("sqlite+aiosqlite:///", "")
    if os.path.exists(db_path):
        shutil.copy2(db_path, db_path + ".bak_v042")

    # SQLite 迁移：重建列
    await conn.execute(text(
        "ALTER TABLE journal_entries ADD COLUMN entry_date_new TIMESTAMP"
    ))
    await conn.execute(text(
        "UPDATE journal_entries SET entry_date_new = entry_date || 'T00:00:00'"
    ))

    # SQLite 不支持 DROP COLUMN（< 3.35.0），使用重建表方式
    # 获取所有列名（排除 entry_date，用 entry_date_new 替代）
    result = await conn.execute(text("PRAGMA table_info(journal_entries)"))
    all_cols = [r[1] for r in result.fetchall()]

    cols_without_old = [c for c in all_cols if c not in ("entry_date", "entry_date_new")]
    select_cols = ", ".join(cols_without_old) + ", entry_date_new AS entry_date"
    insert_cols = ", ".join(cols_without_old) + ", entry_date"

    await conn.execute(text(
        f"CREATE TABLE journal_entries_backup AS SELECT {select_cols} FROM journal_entries"
    ))
    await conn.execute(text("DROP TABLE journal_entries"))
    await conn.execute(text(
        "ALTER TABLE journal_entries_backup RENAME TO journal_entries"
    ))

    # 重建索引
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_date "
        "ON journal_entries(book_id, entry_date)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_type "
        "ON journal_entries(book_id, entry_type)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_reconciliation "
        "ON journal_entries(book_id, reconciliation_status)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_entry_date "
        "ON journal_entries(entry_date)"
    ))
```

---

## 3. Schema 定义

**文件：`server/app/schemas/entry.py`**

### 3.1 变更汇总

| 行号 | 当前 | 变更后 |
|------|------|--------|
| L1 | `from datetime import date, datetime` | `from datetime import datetime` |
| L22 | `entry_date: date` | `entry_date: datetime` |
| L82 | `entry_date: date \| None = None` | `entry_date: datetime \| None = None` |
| L127 | `entry_date: date` | `entry_date: datetime` |

完整变更代码：

```python
from datetime import datetime                    # L1：移除 date 导入

class EntryCreateRequest(BaseModel):
    # ...
    entry_date: datetime                         # L22：必须传 ISO 8601 datetime

class EntryUpdateRequest(BaseModel):
    # ...
    entry_date: datetime | None = None           # L82

class EntryResponse(BaseModel):
    # ...
    entry_date: datetime                         # L127：返回 ISO 8601 datetime
```

> **Pydantic v2 行为**：`datetime` 类型字段接受 `"2026-02-26T14:30:00"` 格式的字符串自动解析。传入纯日期 `"2026-02-26"` 会触发 `ValidationError`（422），无需额外校验器。

### 3.2 BatchEntryItem 继承

**文件：`server/app/schemas/plugin.py`** L194 — `BatchEntryItem` 继承 `EntryCreateRequest`，`entry_date` 类型自动跟随变更为 `datetime`，无需手动修改。

---

## 4. Service 层实现

### 4.1 entry_service.py — 核心变更

**文件：`server/app/services/entry_service.py`**

#### 4.1.1 import 变更

```python
# L3：当前
from datetime import date

# 变更为
from datetime import date, datetime, timedelta
```

> 保留 `date` 导入——`list_entries` 的查询参数 `start_date`/`end_date` 仍为 `date` 类型（用户按天筛选）。

#### 4.1.2 7 个创建函数签名变更

所有创建函数的 `entry_date` 参数类型 `date` → `datetime`：

| 函数 | 行号 | 变更 |
|------|------|------|
| `create_expense` | L220 | `entry_date: date` → `entry_date: datetime` |
| `create_income` | L252 | 同上 |
| `create_asset_purchase` | L283 | 同上 |
| `create_borrow` | L386 | 同上 |
| `create_repayment` | L441 | 同上 |
| `create_transfer` | L483 | 同上 |
| `create_manual_entry` | L515 | 同上 |

示例（以 `create_expense` 为例）：

```python
async def create_expense(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: datetime,               # ← 变更点
    amount: Decimal,
    category_account_id: str,
    payment_account_id: str,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
```

#### 4.1.3 list_entries — 查询边界修正

当前代码（L558-570, L594）：

```python
async def list_entries(
    db: AsyncSession,
    book_id: str,
    page: int = 1,
    page_size: int = 20,
    entry_type: str | None = None,
    start_date: date | None = None,      # 保持 date 类型
    end_date: date | None = None,        # 保持 date 类型
    account_id: str | None = None,
) -> tuple[list[JournalEntry], int]:
    conditions = [JournalEntry.book_id == book_id]

    if entry_type:
        conditions.append(JournalEntry.entry_type == entry_type)
    if start_date:
        conditions.append(JournalEntry.entry_date >= start_date)   # L568
    if end_date:
        conditions.append(JournalEntry.entry_date <= end_date)     # L570
    # ...
    .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())  # L594
```

变更后：

```python
    if start_date:
        # date 与 DateTime 比较：start_date 隐式为当天 00:00:00，无需调整
        conditions.append(
            JournalEntry.entry_date >= datetime(start_date.year, start_date.month, start_date.day)
        )
    if end_date:
        # 关键变更：end_date 为 date 类型，需转为次日 00:00:00 取 < 而非 <=
        next_day = datetime(end_date.year, end_date.month, end_date.day) + timedelta(days=1)
        conditions.append(JournalEntry.entry_date < next_day)
    # ...
    .order_by(JournalEntry.entry_date.desc())  # 移除 created_at 二级排序
```

> **关键变更说明**：
> - `end_date <= '2026-02-26'`（Date 列）会匹配当天所有记录
> - `entry_date <= '2026-02-26'`（DateTime 列）只匹配到 `2026-02-26 00:00:00`，遗漏当天后续记录
> - 改为 `entry_date < '2026-02-27 00:00:00'` 正确包含当天所有时间

### 4.2 report_service.py

**文件：`server/app/services/report_service.py`**

#### 4.2.1 资产负债表 — `as_of_date` 边界（L89）

```python
# 当前
date_filter = [JournalEntry.entry_date <= as_of_date]

# 变更为
from datetime import timedelta
next_day = datetime(as_of_date.year, as_of_date.month, as_of_date.day) + timedelta(days=1)
date_filter = [JournalEntry.entry_date < next_day]
```

#### 4.2.2 损益表 — 日期范围（L172-173）

```python
# 当前
date_filter = [
    JournalEntry.entry_date >= start_date,
    JournalEntry.entry_date <= end_date,
]

# 变更为
next_day = datetime(end_date.year, end_date.month, end_date.day) + timedelta(days=1)
date_filter = [
    JournalEntry.entry_date >= datetime(start_date.year, start_date.month, start_date.day),
    JournalEntry.entry_date < next_day,
]
```

#### 4.2.3 序列化（L279）

```python
# 当前
"entry_date": e.entry_date.isoformat() if isinstance(e.entry_date, date) else str(e.entry_date),

# 变更为（datetime.isoformat() 输出 "2026-02-26T14:30:00"）
"entry_date": e.entry_date.isoformat() if e.entry_date else None,
```

### 4.3 reconciliation_service.py

**文件：`server/app/services/reconciliation_service.py`**

#### 4.3.1 余额查询边界（L40）

```python
# 当前
JournalEntry.entry_date <= as_of_date,

# 变更为
JournalEntry.entry_date < datetime(as_of_date.year, as_of_date.month, as_of_date.day) + timedelta(days=1),
```

#### 4.3.2 创建对账分录（L158）

```python
# 当前
entry_date=target_date,   # target_date 是 date 类型

# 变更为
entry_date=datetime(target_date.year, target_date.month, target_date.day),
```

#### 4.3.3 序列化（L244）

```python
# 当前
"entry_date": e.entry_date.isoformat(),  # date → "2026-02-26"

# 变更后自动变为
"entry_date": e.entry_date.isoformat(),  # datetime → "2026-02-26T00:00:00"
```

### 4.4 depreciation_service.py

**文件：`server/app/services/depreciation_service.py`**

| 行号 | 当前 | 变更后 |
|------|------|--------|
| L143 | `entry_date=date.today()` | `entry_date=datetime.now()` |
| L244 | `entry_date=disposal_date` | `entry_date=datetime(disposal_date.year, disposal_date.month, disposal_date.day)` 如果 `disposal_date` 是 `date` 类型；如果已经是 `datetime` 则不变 |
| L346 | `.order_by(JournalEntry.entry_date.desc())` | 无需变更，自动适配 |
| L352 | `sorted(entries, key=lambda e: e.entry_date)` | 无需变更，`datetime` 可比较 |

### 4.5 import_service.py

**文件：`server/app/services/import_service.py`**

#### 4.5.1 日期解析（L163-170）

```python
# 当前
entry_date_str = row["date"]
try:
    entry_date = date_type.fromisoformat(entry_date_str)      # 产出 date
except (ValueError, TypeError):
    entry_date = datetime.strptime(entry_date_str[:10], "%Y-%m-%d").date()

# 变更为
entry_date_str = row["date"]       # 现在是 "2026-02-26T14:30:00" 格式
try:
    entry_date = datetime.fromisoformat(entry_date_str)        # 产出 datetime
except (ValueError, TypeError):
    entry_date = datetime.strptime(entry_date_str[:19], "%Y-%m-%dT%H:%M:%S")
```

### 4.6 batch_entry_service.py

**文件：`server/app/services/batch_entry_service.py`**

L67-111 处所有 `item.entry_date` 的传递来自 Schema（`BatchEntryItem` 继承 `EntryCreateRequest`），Schema 改了类型后自动适配为 `datetime`，**无需手动修改代码逻辑**。

---

## 5. Router 层实现

### 5.1 entries.py — 查询参数

**文件：`server/app/routers/entries.py`**

#### 5.1.1 import 变更

```python
# L1：保持 date 导入（查询参数仍为 date）
from datetime import date
```

#### 5.1.2 list_entries 查询参数（L220-221）

```python
async def list_entries(
    book_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    entry_type: str | None = None,
    start_date: date | None = None,    # 保持 date —— 用户按天筛选
    end_date: date | None = None,      # 保持 date
    account_id: str | None = None,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
```

> **设计决策**：查询参数保持 `date` 类型，前端传 `?start_date=2026-02-26` 即可。边界转换在 Service 层完成（4.1.3 节）。

### 5.2 reports.py — 查询参数

**文件：`server/app/routers/reports.py`**

报表查询参数 `as_of_date`（L42）、`start`/`end`（L60-61、L113-114）保持 `date` 类型不变，边界转换在 Service 层完成。

---

## 6. 解析器 & 插件

### 6.1 wechat.py — 保留完整时间

**文件：`server/app/parsers/wechat.py`**

当前代码（L107-113）：

```python
try:
    dt = datetime.strptime(raw_time, "%Y-%m-%d %H:%M:%S")
    date_str = dt.strftime("%Y-%m-%d")           # 截断为日期
except ValueError:
    date_str = raw_time[:10]

result.append({
    "date": date_str,                             # 仅日期
```

变更后：

```python
try:
    dt = datetime.strptime(raw_time, "%Y-%m-%d %H:%M:%S")
    date_str = dt.strftime("%Y-%m-%dT%H:%M:%S")  # 保留完整时间
except ValueError:
    # fallback：尝试提取日期，补 00:00:00
    date_str = raw_time[:10] + "T00:00:00"

result.append({
    "date": date_str,                              # 完整 datetime
```

### 6.2 bank_monitor/plugin.py — 完整时间输出

**文件：`plugins/bank_monitor/plugin.py`**

当前代码（L307）：

```python
entry_date = record.get("msg_time", "")[:10]   # 截断为 YYYY-MM-DD
```

变更后：

```python
raw_time = record.get("msg_time", "")
# msg_time 格式通常为 "2026-02-26 14:30:00"，转为 ISO 8601
entry_date = raw_time.replace(" ", "T")[:19] if len(raw_time) >= 19 else raw_time[:10] + "T00:00:00"
```

### 6.3 MCP entries.py — 文档更新

**文件：`server/mcp_server/tools/entries.py`**

当前代码（L18）：

```python
        - entry_date: 日期 (YYYY-MM-DD)
```

变更为：

```python
        - entry_date: 日期时间 (YYYY-MM-DDTHH:mm:ss)
```

---

## 7. 前端实现

### 7.1 DateTimePicker 组件

**文件：`client/components/DateTimePicker.tsx`** — 新增

```tsx
import React, { useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label?: string;
  labelStyle?: any;
  containerStyle?: any;
  colors?: { text: string; textSecondary: string; border: string };
}

export function DateTimePicker({
  value, onChange, label, labelStyle, containerStyle, colors,
}: DateTimePickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  // 格式化显示：YYYY-MM-DD HH:mm
  const formatDisplay = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 格式化为 ISO 提交格式：YYYY-MM-DDTHH:mm:ss
  const formatISO = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (Platform.OS === 'web') {
    // Web：使用 <input type="datetime-local">
    const webValue = formatISO(value).slice(0, 16); // "YYYY-MM-DDTHH:mm"
    return (
      <View style={containerStyle}>
        {label && <Text style={labelStyle}>{label}</Text>}
        <input
          type="datetime-local"
          value={webValue}
          onChange={(e) => {
            const d = new Date(e.target.value);
            if (!isNaN(d.getTime())) onChange(d);
          }}
          style={{
            fontSize: 16,
            padding: 8,
            border: 'none',
            background: 'transparent',
            color: colors?.text ?? '#1F2937',
            outline: 'none',
          }}
        />
      </View>
    );
  }

  // iOS / Android：使用 @react-native-community/datetimepicker
  // 动态 require 避免 web 端报错
  const RNDateTimePicker = require('@react-native-community/datetimepicker').default;

  return (
    <View style={containerStyle}>
      {label && <Text style={labelStyle}>{label}</Text>}
      <Pressable onPress={() => setShowPicker(true)}>
        <Text style={{ fontSize: 16, color: colors?.text ?? '#1F2937', paddingVertical: 8 }}>
          {formatDisplay(value)}
        </Text>
      </Pressable>
      {showPicker && (
        <RNDateTimePicker
          value={value}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_: any, selectedDate?: Date) => {
            setShowPicker(Platform.OS === 'android');  // Android 选择后自动关闭
            if (selectedDate) onChange(selectedDate);
          }}
          maximumDate={new Date(2100, 0, 1)}
          minuteInterval={1}
        />
      )}
    </View>
  );
}

// 导出工具函数，供提交时使用
export function toISODateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
```

### 7.2 entry/new.tsx — 日期输入改造

**文件：`client/app/entry/new.tsx`**

#### 7.2.1 移除 `todayStr()`，改用 `Date` 对象

```typescript
// 当前（L45-48, L78）——删除
function todayStr() { ... }
const [entryDate, setEntryDate] = useState(todayStr());

// 变更为
import { DateTimePicker, toISODateTimeString } from '@/components/DateTimePicker';
const [entryDate, setEntryDate] = useState(new Date());
```

#### 7.2.2 UI 替换（L1107-1115）

```tsx
// 当前
<View style={[styles.field, { borderColor: colors.border }]}>
  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>日期</Text>
  <TextInput
    style={[styles.textInput, { color: colors.text }]}
    value={entryDate}
    onChangeText={setEntryDate}
    placeholder="YYYY-MM-DD"
    placeholderTextColor={colors.textSecondary}
  />
</View>

// 变更为
<DateTimePicker
  value={entryDate}
  onChange={setEntryDate}
  label="日期"
  labelStyle={[styles.fieldLabel, { color: colors.textSecondary }]}
  containerStyle={[styles.field, { borderColor: colors.border }]}
  colors={colors}
/>
```

#### 7.2.3 提交参数（L388-393）

```typescript
// 当前
const params: EntryCreateParams = {
  entry_type: entryType,
  entry_date: entryDate,            // string "2026-02-26"
  ...
};

// 变更为
const params: EntryCreateParams = {
  entry_type: entryType,
  entry_date: toISODateTimeString(entryDate),  // "2026-02-26T14:30:00"
  ...
};
```

#### 7.2.4 编辑模式预填（L269 附近）

```typescript
// 当前
setEntryDate(data.entry_date);       // string "2026-02-26"

// 变更为
setEntryDate(new Date(data.entry_date));  // Date from "2026-02-26T14:30:00"
```

### 7.3 entry/[id].tsx — 详情页显示

**文件：`client/app/entry/[id].tsx`**

```tsx
// 当前（L204）
<Text style={styles.value}>{entry.entry_date}</Text>

// 变更为：格式化展示
<Text style={styles.value}>
  {entry.entry_date.replace('T', '  ').slice(0, 17)}
</Text>
// 输出："2026-02-26  14:30"
```

### 7.4 ledger.tsx — 分组逻辑

**文件：`client/app/(tabs)/ledger.tsx`**

#### 7.4.1 groupByDate 函数（L54-63）

```typescript
// 当前
function groupByDate(entries: EntryResponse[]): { date: string; items: EntryResponse[] }[] {
  const map = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const d = e.entry_date;              // "2026-02-26"
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

// 变更为
function groupByDate(entries: EntryResponse[]): { date: string; items: EntryResponse[] }[] {
  const map = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const d = e.entry_date.slice(0, 10);  // "2026-02-26T14:30:00" → "2026-02-26"
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}
```

#### 7.4.2 列表项新增时间列

在 EntryCard 或内联渲染处，从 `entry_date` 提取时间展示：

```tsx
// 提取 HH:mm
const time = entry.entry_date.slice(11, 16);  // "14:30"

// 渲染
<Text style={styles.time}>{time === '00:00' ? '--:--' : time}</Text>
```

> **旧数据处理**：迁移后旧数据时间为 `00:00`，前端展示为 `--:--` 避免困惑。

### 7.5 entryService.ts — 类型注释更新

**文件：`client/services/entryService.ts`**

```typescript
export type EntryCreateParams = {
  entry_type: EntryType;
  entry_date: string; // ISO 8601: YYYY-MM-DDTHH:mm:ss       ← L22 更新注释
  // ...
};

export type EntryUpdateParams = {
  entry_date?: string; // ISO 8601: YYYY-MM-DDTHH:mm:ss      ← L58
  // ...
};

export type EntryResponse = {
  // ...
  entry_date: string; // ISO 8601: YYYY-MM-DDTHH:mm:ss       ← L93
  // ...
};

export type ListEntriesParams = {
  // ...
  start_date?: string; // YYYY-MM-DD（仍按天筛选）            ← L120 保持不变
  end_date?: string;   // YYYY-MM-DD                          ← L121 保持不变
  // ...
};
```

### 7.6 ReconcileCard.tsx — 格式化

**文件：`client/features/sync/ReconcileCard.tsx`**

```tsx
// 当前（L54）
<Text style={[styles.date, { color: colors.textSecondary }]}>{item.entry_date}</Text>

// 变更为
<Text style={[styles.date, { color: colors.textSecondary }]}>
  {item.entry_date.slice(0, 10)}
</Text>
```

### 7.7 reportService.ts / syncService.ts — 注释更新

```typescript
// client/services/reportService.ts L42
export type RecentEntryItem = {
  entry_date: string;  // ISO 8601: YYYY-MM-DDTHH:mm:ss
  // ...
};

// client/services/syncService.ts L37
export type PendingReconcileItem = {
  entry_date: string;  // ISO 8601: YYYY-MM-DDTHH:mm:ss
  // ...
};
```

---

## 8. 依赖变更

### 8.1 前端

| 包 | 版本 | 用途 | 状态 |
|----|------|------|------|
| `@react-native-community/datetimepicker` | `^8.0.0` | 原生日期时间选择器（iOS/Android） | **新增** |

安装命令：

```bash
cd client
npx expo install @react-native-community/datetimepicker
```

> 当前 `package.json` 中无任何 datetimepicker 依赖。Web 端使用 HTML 原生 `<input type="datetime-local">`，无需额外依赖。

### 8.2 后端

无新增依赖。

---

## 9. 测试变更

### 9.1 变更策略

所有测试文件中的 `entry_date` 值必须从纯日期格式更新为 `datetime` 格式：

```python
# 当前
"entry_date": "2025-06-15"

# 变更为
"entry_date": "2025-06-15T10:30:00"
```

### 9.2 各文件变更量

| 文件 | 位置数 | 示例变更 |
|------|--------|---------|
| `test_entries.py` | 24 | `"2025-06-15"` → `"2025-06-15T10:30:00"` |
| `test_batch_entries.py` | 9 | 同上 |
| `test_entry_convert.py` | 6 | 同上 |
| `test_e2e_api_key_plugin_flow.py` | 5 | 同上 |
| `test_mcp_e2e.py` | 4 | 同上 |
| `test_budget_api.py` | 2 | 同上 |
| `test_reports.py` | 2 | 同上 |
| `test_leaf_account.py` | 2 | 同上 |
| `test_sync.py` | 1 | 同上 |
| **合计** | **55** | |

### 9.3 新增测试用例

在 `test_entries.py` 中新增以下测试：

| 用例 | 验证内容 |
|------|---------|
| `test_create_entry_with_datetime` | 传入 `"2025-06-15T14:30:00"` 创建成功，返回完整 datetime |
| `test_create_entry_with_date_only_rejected` | 传入 `"2025-06-15"` 返回 422 |
| `test_same_day_ordering_by_time` | 创建 3 条同日不同时间的记录，列表按时间倒序 |
| `test_list_entries_end_date_boundary` | `end_date=2025-06-15` 包含 `2025-06-15T23:59:59` 的记录 |
| `test_report_as_of_date_boundary` | 资产负债表 `as_of_date=2025-06-15` 包含当天所有时间的分录 |

---

## 10. 开发实施计划

### 阶段 1：数据模型 & 迁移（预计 0.5 天）

1. `server/app/models/journal.py` — `entry_date` 类型 `Date` → `DateTime`
2. `server/app/database.py` — 新增 `_migrate_entry_date_to_datetime`
3. 本地测试迁移脚本（空表 + 有数据表）

### 阶段 2：Schema + Service 后端（预计 1 天）

1. `server/app/schemas/entry.py` — 3 处类型变更
2. `server/app/services/entry_service.py` — 函数签名 + 查询边界 + 排序
3. `server/app/services/report_service.py` — 边界修正
4. `server/app/services/reconciliation_service.py` — 边界 + 创建
5. `server/app/services/depreciation_service.py` — `date.today()` → `datetime.now()`
6. `server/app/services/import_service.py` — 日期解析
7. `server/app/services/batch_entry_service.py` — 验证透传正确

### 阶段 3：Router + 解析器 + 插件（预计 0.5 天）

1. `server/app/routers/entries.py` — 验证查询参数传递
2. `server/app/routers/reports.py` — 同上
3. `server/app/parsers/wechat.py` — 完整时间输出
4. `server/mcp_server/tools/entries.py` — 文档更新
5. `plugins/bank_monitor/plugin.py` — 完整时间输出

### 阶段 4：测试适配（预计 1 天）

1. 9 个测试文件共 55 处格式更新
2. 新增 5 个验证用例
3. 全量测试通过

### 阶段 5：前端 DateTimePicker 组件（预计 1 天）

1. 安装 `@react-native-community/datetimepicker`
2. 实现 `DateTimePicker.tsx` 跨平台组件
3. Web / iOS / Android 三端验证

### 阶段 6：前端页面适配（预计 1 天）

1. `app/entry/new.tsx` — TextInput → DateTimePicker
2. `app/entry/[id].tsx` — 回填 + 显示
3. `app/(tabs)/ledger.tsx` — 分组 + 时间列
4. `services/*.ts` — 注释更新
5. `ReconcileCard.tsx` — 格式化

### 阶段 7：联调 & 测试（预计 0.5 天）

1. 端到端：新建 → 列表 → 编辑 → 报表
2. 迁移：有数据的库升级后验证
3. 三端 UI 验证（Web / Android / iOS）

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 数据模型 & 迁移 | 0.5 天 | 0.5 天 |
| 2 | Schema + Service | 1 天 | 1.5 天 |
| 3 | Router + 解析器 + 插件 | 0.5 天 | 2 天 |
| 4 | 测试适配 | 1 天 | 3 天 |
| 5 | 前端 DateTimePicker | 1 天 | 4 天 |
| 6 | 前端页面适配 | 1 天 | 5 天 |
| 7 | 联调 & 测试 | 0.5 天 | 5.5 天 |

> v0.4.2 总计约 **5.5 个工作日**。

---

## 11. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| 迁移数据丢失 | 迁移前自动备份 `.bak_v042` 文件 |
| SQLite `TIMESTAMP` 格式不一致 | 统一 `YYYY-MM-DDTHH:MM:SS` 格式，ORM 层通过 `DateTime` 类型保证 |
| 时区混乱 | 当前单用户本地部署，存储 naive datetime；后续版本再引入 UTC |
| `datetimepicker` 原生崩溃 | Web 降级为 HTML input；测试覆盖 Android 10+ / iOS 15+ |
| 旧数据 `00:00` 用户困惑 | 前端 `00:00` 显示为 `--:--` |
