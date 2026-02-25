# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.1**
> **创建日期：2026-02-25**
> **基于版本：v0.2.0**
> **状态：规划中**
> **本版本变更：插件动态配置（config_schema / config）；微信账单 xlsx 导入（解析、筛选、分批科目映射、幂等导入）**

---

## 1. 技术架构概述

v0.4.1 包含两个功能模块：

1. **插件动态配置**：`plugins` 表新增 `config_schema` / `config` 字段，前端动态渲染配置表单
2. **微信账单导入**：新增 `import_tasks` 表、微信 xlsx 解析器、导入 API、前端导入 UI

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：Python FastAPI + SQLAlchemy (async) + SQLite (aiosqlite)

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **数据模型** | `server/app/models/plugin.py` | 修改 | 新增 `config_schema`、`config` 字段 |
| **数据模型** | `server/app/models/import_task.py` | 新增 | `ImportTask` 模型 |
| **数据模型** | `server/app/models/journal.py` | 修改 | `source` 枚举新增 `"import"` |
| **数据模型** | `server/app/models/__init__.py` | 修改 | 导入 `ImportTask` |
| **Schema** | `server/app/schemas/plugin.py` | 修改 | 新增 `config_schema`/`config` 相关字段、`PluginConfigUpdateRequest` |
| **Schema** | `server/app/schemas/import_task.py` | 新增 | 导入相关请求/响应 schema |
| **Service** | `server/app/services/plugin_service.py` | 修改 | `create_plugin` 处理 `config_schema`；新增 `update_plugin_config` |
| **Service** | `server/app/services/import_service.py` | 新增 | 导入服务（上传解析、确认导入、历史查询、撤销） |
| **解析器** | `server/app/parsers/__init__.py` | 新增 | 解析器包 |
| **解析器** | `server/app/parsers/wechat.py` | 新增 | 微信账单 xlsx 解析器 |
| **Router** | `server/app/routers/plugins.py` | 修改 | 新增 `PUT /plugins/{plugin_id}/config` |
| **Router** | `server/app/routers/import_router.py` | 新增 | 导入 API 路由 |
| **Router** | `server/app/main.py` | 修改 | 注册 `import_router` |
| **迁移** | `server/app/database.py` | 修改 | 新增 `_migrate_plugin_config`、`_migrate_journal_source` |
| **前端 Service** | `client/services/pluginService.ts` | 修改 | 新增 `updateConfig` 方法、类型扩展 |
| **前端 Service** | `client/services/importService.ts` | 新增 | 导入 API 封装 |
| **前端组件** | `client/features/plugin/PluginsPane.tsx` | 修改 | 配置状态展示 + 配置按钮 + 展开式表单 |
| **前端组件** | `client/features/plugin/PluginConfigForm.tsx` | 新增 | 动态配置表单组件 |
| **前端组件** | `client/features/import/DataImportPane.tsx` | 新增 | 导入面板 |
| **前端组件** | `client/features/import/ImportPreview.tsx` | 新增 | 解析预览（筛选 + 行选择 + 科目指定） |
| **前端组件** | `client/features/import/ImportFilterBar.tsx` | 新增 | 筛选栏组件 |
| **前端组件** | `client/features/import/ImportHistory.tsx` | 新增 | 导入历史 + 撤销 |
| **前端页面** | `client/app/settings/plugin-config.tsx` | 新增 | 移动端插件配置页 |
| **前端页面** | `client/app/settings/data-import.tsx` | 新增 | 移动端导入页 |
| **前端页面** | `client/app/(tabs)/profile.tsx` | 修改 | 激活「数据导入/导出」入口 |
| **前端类型** | `client/features/profile/types.ts` | 修改 | `DetailPane` 新增 `'data-import'` |

---

## 2. 数据模型实现

### 2.1 `plugins` 表 — 新增字段

**文件：`server/app/models/plugin.py`**

在现有 `Plugin` 模型中新增两个 JSON 字段：

```python
from sqlalchemy import Text

class Plugin(Base):
    __tablename__ = "plugins"
    # ... 现有字段不变 ...

    # v0.4.1 新增
    config_schema: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="插件声明的配置结构（JSON 字符串）"
    )
    config: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="用户填写的配置值（JSON 字符串）"
    )
```

> **设计决策**：使用 `Text` 而非 SQLAlchemy `JSON` 类型，因为 SQLite 对 JSON 类型支持有限。读写时通过 `json.loads()` / `json.dumps()` 序列化。

### 2.2 `import_tasks` 表

**文件：`server/app/models/import_task.py`**

```python
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ImportTask(Base):
    __tablename__ = "import_tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    format: Mapped[str] = mapped_column(
        String(20), nullable=False, default="wechat"
    )
    original_filename: Mapped[str] = mapped_column(
        String(500), nullable=False
    )
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(
        String(20), default="parsed"
    )  # parsed / partial / imported / failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_data: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="解析后的标准化数据 JSON（确认导入后可清空）"
    )
    config: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="各批次的科目映射记录 JSON"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # 关系
    book = relationship("Book")
    user = relationship("User")
```

### 2.3 `journal_entries.source` — 新增枚举值

**文件：`server/app/models/journal.py`**

当前 `source` 字段为 `SAEnum("manual", "sync", "reconciliation")`，需新增 `"import"` 值。

由于 SQLite 的 Enum 实际以 `VARCHAR` 存储，不需要做 DDL 变更，只需修改 ORM 层声明：

```python
source: Mapped[str] = mapped_column(
    SAEnum("manual", "sync", "reconciliation", "import", name="entry_source"),
    default="manual",
)
```

### 2.4 数据库迁移

**文件：`server/app/database.py`** — 在 `init_db()` 中追加两个迁移函数：

```python
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_budgets(conn)
        await _migrate_journal_external_id(conn)
        await _migrate_users_admin(conn)
        # v0.4.1
        await _migrate_plugin_config(conn)


async def _migrate_plugin_config(conn):
    """为 plugins 表补充 v0.4.1 新增的 config_schema 和 config 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(plugins)"))
    columns = {row[1] for row in result.fetchall()}

    migrations = [
        ("config_schema", "ALTER TABLE plugins ADD COLUMN config_schema TEXT"),
        ("config", "ALTER TABLE plugins ADD COLUMN config TEXT"),
    ]
    for col_name, sql in migrations:
        if col_name not in columns:
            await conn.execute(text(sql))
```

> **说明**：`import_tasks` 为新表，`create_all()` 会自动创建，无需手动迁移。`source` 枚举在 SQLite 中存储为 VARCHAR，新增值无需 DDL 变更。

---

## 3. Schema 定义

### 3.1 Plugin Schema 变更

**文件：`server/app/schemas/plugin.py`** — 修改

```python
import json
from typing import Any

# ─── 新增：配置更新请求 ─────────────────────────
class PluginConfigUpdateRequest(BaseModel):
    config: dict[str, Any] = Field(..., description="配置键值对")


# ─── 修改：注册请求新增 config_schema ─────────────────────────
class PluginCreateRequest(BaseModel):
    name: str = Field(..., max_length=100, description="插件名称")
    type: Literal["entry", "balance", "both"] = Field(..., description="插件类型")
    description: str | None = Field(None, description="插件描述")
    config_schema: dict[str, Any] | None = Field(
        None, description="配置结构定义，包含 fields 数组"
    )


# ─── 修改：响应新增字段 ─────────────────────────
class PluginResponse(BaseModel):
    id: str
    name: str
    type: str
    api_key_id: str
    description: str | None
    last_sync_at: datetime | None
    last_sync_status: str
    last_error_message: str | None
    sync_count: int
    created_at: datetime
    updated_at: datetime

    # v0.4.1 新增
    config_schema: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    has_config: bool = False
    is_configured: bool = False

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def parse_json_fields(cls, data):
        """将 Text 字段的 JSON 字符串反序列化为 dict"""
        if hasattr(data, "__dict__"):
            # ORM 对象
            raw_schema = getattr(data, "config_schema", None)
            raw_config = getattr(data, "config", None)
        else:
            raw_schema = data.get("config_schema")
            raw_config = data.get("config")

        parsed_schema = None
        parsed_config = None

        if isinstance(raw_schema, str):
            try:
                parsed_schema = json.loads(raw_schema)
            except (json.JSONDecodeError, TypeError):
                parsed_schema = None
        elif isinstance(raw_schema, dict):
            parsed_schema = raw_schema

        if isinstance(raw_config, str):
            try:
                parsed_config = json.loads(raw_config)
            except (json.JSONDecodeError, TypeError):
                parsed_config = None
        elif isinstance(raw_config, dict):
            parsed_config = raw_config

        # 计算 has_config 和 is_configured
        has_config = parsed_schema is not None and bool(
            parsed_schema.get("fields")
        )
        is_configured = False
        if has_config and parsed_config:
            required_keys = [
                f["key"]
                for f in parsed_schema.get("fields", [])
                if f.get("required")
            ]
            is_configured = all(
                parsed_config.get(k) not in (None, "")
                for k in required_keys
            )

        if hasattr(data, "__dict__"):
            # 返回 dict 给 pydantic
            return {
                **{
                    k: getattr(data, k)
                    for k in [
                        "id", "name", "type", "api_key_id", "description",
                        "last_sync_at", "last_sync_status", "last_error_message",
                        "sync_count", "created_at", "updated_at",
                    ]
                },
                "config_schema": parsed_schema,
                "config": parsed_config,
                "has_config": has_config,
                "is_configured": is_configured,
            }
        else:
            data["config_schema"] = parsed_schema
            data["config"] = parsed_config
            data["has_config"] = has_config
            data["is_configured"] = is_configured
            return data


# ─── 列表响应（不含 config_schema/config 详情）─────────────────────────
class PluginListResponse(BaseModel):
    id: str
    name: str
    type: str
    api_key_id: str
    description: str | None
    last_sync_at: datetime | None
    last_sync_status: str
    last_error_message: str | None
    sync_count: int
    has_config: bool = False
    is_configured: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def compute_config_status(cls, data):
        """从 ORM 对象计算 has_config / is_configured"""
        if hasattr(data, "__dict__"):
            raw_schema = getattr(data, "config_schema", None)
            raw_config = getattr(data, "config", None)
            parsed_schema = (
                json.loads(raw_schema) if isinstance(raw_schema, str) else raw_schema
            )
            parsed_config = (
                json.loads(raw_config) if isinstance(raw_config, str) else raw_config
            )

            has_config = parsed_schema is not None and bool(
                parsed_schema.get("fields") if isinstance(parsed_schema, dict) else False
            )
            is_configured = False
            if has_config and isinstance(parsed_config, dict):
                required_keys = [
                    f["key"]
                    for f in parsed_schema.get("fields", [])
                    if f.get("required")
                ]
                is_configured = all(
                    parsed_config.get(k) not in (None, "")
                    for k in required_keys
                )

            return {
                **{
                    k: getattr(data, k)
                    for k in [
                        "id", "name", "type", "api_key_id", "description",
                        "last_sync_at", "last_sync_status", "last_error_message",
                        "sync_count", "created_at", "updated_at",
                    ]
                },
                "has_config": has_config,
                "is_configured": is_configured,
            }
        return data
```

### 3.2 Import Task Schema

**文件：`server/app/schemas/import_task.py`**

```python
from datetime import datetime
from decimal import Decimal
from typing import Literal, Any

from pydantic import BaseModel, Field


# ─── 上传解析响应 ─────────────────────────

class ImportRowItem(BaseModel):
    index: int
    date: str
    description: str
    amount: Decimal = Field(description="金额（正数），方向由 direction 表达")
    direction: Literal["支出", "收入", "中性交易"]
    payment_method: str
    external_id: str
    is_duplicate: bool = False


class ImportFilters(BaseModel):
    directions: list[str]
    payment_methods: list[str]


class ImportSummary(BaseModel):
    income_count: int
    income_total: Decimal
    expense_count: int
    expense_total: Decimal
    neutral_count: int
    neutral_total: Decimal
    duplicate_count: int


class ImportUploadResponse(BaseModel):
    task_id: str
    format: str
    total_rows: int
    rows: list[ImportRowItem]
    filters: ImportFilters
    summary: ImportSummary
    status: str


# ─── 确认导入请求 ─────────────────────────

class ImportConfirmEntryGroup(BaseModel):
    indexes: list[int] = Field(..., description="行索引列表")
    expense_account_id: str | None = Field(None, description="支出费用科目")
    income_account_id: str | None = Field(None, description="收入科目")
    payment_account_id: str | None = Field(None, description="支付/收款资产科目（支出/收入时必填）")
    from_account_id: str | None = Field(None, description="中性交易转出资产科目")
    to_account_id: str | None = Field(None, description="中性交易转入资产科目")


class ImportConfirmRequest(BaseModel):
    entries: list[ImportConfirmEntryGroup] = Field(
        ..., description="分组数组，每组包含行索引和目标科目"
    )


class ImportConfirmResponse(BaseModel):
    task_id: str
    status: str
    imported_rows: int
    skipped_rows: int
    total_confirmed: int


# ─── 导入历史响应 ─────────────────────────

class ImportHistoryItem(BaseModel):
    id: str
    format: str
    original_filename: str
    total_rows: int
    imported_rows: int
    skipped_rows: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── 撤销导入响应 ─────────────────────────

class ImportDeleteResponse(BaseModel):
    deleted_count: int
```

---

## 4. Service 层实现

### 4.1 Plugin Config Service

**文件：`server/app/services/plugin_service.py`** — 修改

#### 4.1.1 `create_plugin` 修改

```python
import json

async def create_plugin(
    db: AsyncSession,
    user_id: str,
    api_key_id: str,
    body: PluginCreateRequest,
) -> tuple[Plugin, bool]:
    """注册插件（幂等）。v0.4.1: 支持 config_schema。"""
    stmt = select(Plugin).where(
        Plugin.user_id == user_id,
        Plugin.name == body.name,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    config_schema_str = (
        json.dumps(body.config_schema, ensure_ascii=False)
        if body.config_schema
        else None
    )

    if existing:
        existing.api_key_id = api_key_id
        if body.type:
            existing.type = body.type
        if body.description is not None:
            existing.description = body.description
        # v0.4.1: 更新 config_schema，但不覆盖用户已填的 config
        if config_schema_str is not None:
            existing.config_schema = config_schema_str
        existing.updated_at = datetime.utcnow()
        await db.flush()
        await db.refresh(existing)
        return existing, False

    plugin = Plugin(
        user_id=user_id,
        api_key_id=api_key_id,
        name=body.name,
        type=body.type,
        description=body.description,
        config_schema=config_schema_str,
    )
    db.add(plugin)
    await db.flush()
    await db.refresh(plugin)
    return plugin, True
```

#### 4.1.2 `update_plugin_config` 新增

```python
async def update_plugin_config(
    db: AsyncSession,
    plugin_id: str,
    user_id: str,
    config: dict,
    book_id: str | None = None,
) -> Plugin:
    """更新插件配置（含校验）"""
    plugin = await get_plugin(db, plugin_id, user_id)

    if not plugin.config_schema:
        raise HTTPException(400, "该插件不支持配置")

    schema = json.loads(plugin.config_schema)
    fields = schema.get("fields", [])

    # 校验
    errors = []
    filtered_config = {}

    for field_def in fields:
        key = field_def["key"]
        field_type = field_def["type"]
        required = field_def.get("required", False)
        value = config.get(key)

        # 必填校验
        if required and value in (None, ""):
            errors.append({"key": key, "error": "必填字段不能为空"})
            continue

        if value is None:
            # 非必填且未提供 → 使用 default 或跳过
            default = field_def.get("default")
            if default is not None:
                filtered_config[key] = default
            continue

        # 类型校验
        if field_type == "number" and not isinstance(value, (int, float)):
            errors.append({"key": key, "error": f"期望数字类型，实际为 {type(value).__name__}"})
            continue
        if field_type == "boolean" and not isinstance(value, bool):
            errors.append({"key": key, "error": f"期望布尔类型，实际为 {type(value).__name__}"})
            continue
        if field_type == "select":
            options = [o["value"] for o in field_def.get("options", [])]
            if value not in options:
                errors.append({"key": key, "error": f"值 '{value}' 不在允许范围内: {options}"})
                continue
        if field_type == "account_select" and book_id:
            # 校验 account_id 存在于用户的账本中
            from app.models.account import Account
            result = await db.execute(
                select(Account).where(
                    Account.id == value,
                    Account.book_id == book_id,
                )
            )
            if not result.scalar_one_or_none():
                errors.append({"key": key, "error": f"科目 {value} 不存在或不属于当前账本"})
                continue

        filtered_config[key] = value

    if errors:
        raise HTTPException(422, detail={"message": "配置校验失败", "errors": errors})

    plugin.config = json.dumps(filtered_config, ensure_ascii=False)
    plugin.updated_at = datetime.utcnow()
    await db.flush()
    await db.refresh(plugin)
    return plugin
```

### 4.2 Import Service

**文件：`server/app/services/import_service.py`**

```python
"""微信账单导入 Service"""

import json
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_task import ImportTask
from app.models.journal import JournalEntry, JournalLine
from app.models.user import User
from app.parsers.wechat import parse_wechat_xlsx
from app.schemas.import_task import (
    ImportConfirmEntryGroup,
    ImportConfirmResponse,
    ImportDeleteResponse,
    ImportRowItem,
    ImportUploadResponse,
    ImportFilters,
    ImportSummary,
)
from app.services.batch_entry_service import _validate_book_access, _find_by_external_id
from app.services.entry_service import create_expense, create_income, create_transfer


# ─── 上传并解析 ─────────────────────────

async def upload_and_parse(
    db: AsyncSession,
    user: User,
    book_id: str,
    file: UploadFile,
) -> ImportUploadResponse:
    """上传微信账单 xlsx，解析并返回预览"""

    # 1. 校验账本权限
    await _validate_book_access(db, book_id, user)

    # 2. 校验文件
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "仅支持 .xlsx 格式")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "文件大小不能超过 10MB")

    # 3. 解析
    try:
        parsed_rows = parse_wechat_xlsx(content)
    except ValueError as e:
        raise HTTPException(422, str(e))

    if not parsed_rows:
        raise HTTPException(422, "解析后无有效交易记录")

    # 4. 标记重复
    for row in parsed_rows:
        existing = await _find_by_external_id(db, book_id, row["external_id"])
        row["is_duplicate"] = existing is not None

    # 5. 构建筛选维度
    directions = sorted(set(r["direction"] for r in parsed_rows))
    payment_methods = sorted(set(
        r["payment_method"] for r in parsed_rows
        if r["payment_method"] != "/"
    ))

    # 6. 构建汇总
    income_rows = [r for r in parsed_rows if r["direction"] == "收入"]
    expense_rows = [r for r in parsed_rows if r["direction"] == "支出"]
    neutral_rows = [r for r in parsed_rows if r["direction"] == "中性交易"]
    duplicate_rows = [r for r in parsed_rows if r["is_duplicate"]]

    summary = ImportSummary(
        income_count=len(income_rows),
        income_total=sum(Decimal(str(r["amount"])) for r in income_rows),
        expense_count=len(expense_rows),
        expense_total=sum(Decimal(str(r["amount"])) for r in expense_rows),
        neutral_count=len(neutral_rows),
        neutral_total=sum(Decimal(str(r["amount"])) for r in neutral_rows),
        duplicate_count=len(duplicate_rows),
    )

    # 7. 创建 ImportTask 记录
    task = ImportTask(
        book_id=book_id,
        user_id=user.id,
        format="wechat",
        original_filename=file.filename or "unknown.xlsx",
        total_rows=len(parsed_rows),
        status="parsed",
        parsed_data=json.dumps(parsed_rows, ensure_ascii=False, default=str),
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    # 8. 构建响应
    rows = [
        ImportRowItem(
            index=i,
            date=r["date"],
            description=r["description"],
            amount=Decimal(str(r["amount"])),
            direction=r["direction"],
            payment_method=r["payment_method"],
            external_id=r["external_id"],
            is_duplicate=r["is_duplicate"],
        )
        for i, r in enumerate(parsed_rows)
    ]

    return ImportUploadResponse(
        task_id=task.id,
        format="wechat",
        total_rows=len(parsed_rows),
        rows=rows,
        filters=ImportFilters(directions=directions, payment_methods=payment_methods),
        summary=summary,
        status="parsed",
    )


# ─── 确认导入 ─────────────────────────

async def confirm_import(
    db: AsyncSession,
    user: User,
    book_id: str,
    task_id: str,
    entry_groups: list[ImportConfirmEntryGroup],
) -> ImportConfirmResponse:
    """分批确认导入，为所选行创建分录"""

    # 1. 获取 task
    task = await _get_task(db, task_id, book_id, user.id)
    if task.status == "failed":
        raise HTTPException(400, "该导入任务已失败，无法继续导入")

    parsed_data = json.loads(task.parsed_data)

    imported_count = 0
    skipped_count = 0

    for group in entry_groups:
        for idx in group.indexes:
            if idx < 0 or idx >= len(parsed_data):
                raise HTTPException(400, f"行索引 {idx} 超出范围")

            row = parsed_data[idx]
            external_id = row["external_id"]

            # 幂等：检查是否已导入
            existing = await _find_by_external_id(db, book_id, external_id)
            if existing:
                skipped_count += 1
                continue

            # 根据 direction 创建分录
            amount = Decimal(str(row["amount"]))
            entry_date_str = row["date"]
            description = row["description"]

            try:
                if row["direction"] == "支出":
                    if not group.expense_account_id:
                        raise HTTPException(
                            422, f"支出行 {idx} 需要 expense_account_id"
                        )
                    if not group.payment_account_id:
                        raise HTTPException(
                            422, f"支出行 {idx} 需要 payment_account_id"
                        )
                    entry = await create_expense(
                        db, book_id, user.id,
                        entry_date_str, amount,
                        group.expense_account_id,
                        group.payment_account_id,
                        description, None,
                    )

                elif row["direction"] == "收入":
                    if not group.income_account_id:
                        raise HTTPException(
                            422, f"收入行 {idx} 需要 income_account_id"
                        )
                    if not group.payment_account_id:
                        raise HTTPException(
                            422, f"收入行 {idx} 需要 payment_account_id"
                        )
                    entry = await create_income(
                        db, book_id, user.id,
                        entry_date_str, amount,
                        group.income_account_id,
                        group.payment_account_id,
                        description, None,
                    )

                elif row["direction"] == "中性交易":
                    if not group.from_account_id or not group.to_account_id:
                        raise HTTPException(
                            422,
                            f"中性交易行 {idx} 需要 from_account_id 和 to_account_id",
                        )
                    entry = await create_transfer(
                        db, book_id, user.id,
                        entry_date_str, amount,
                        group.from_account_id,
                        group.to_account_id,
                        description, None,
                    )
                else:
                    raise HTTPException(400, f"未知 direction: {row['direction']}")

                # 设置元数据
                entry.external_id = external_id
                entry.source = "import"
                await db.flush()
                imported_count += 1

            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    400, f"行 {idx} 导入失败: {str(e)}"
                )

    # 更新 task 状态
    task.imported_rows = (task.imported_rows or 0) + imported_count
    task.skipped_rows = (task.skipped_rows or 0) + skipped_count

    total_confirmed = task.imported_rows
    if total_confirmed >= task.total_rows:
        task.status = "imported"
    elif total_confirmed > 0:
        task.status = "partial"

    # 记录本次科目映射
    existing_config = json.loads(task.config) if task.config else []
    existing_config.append({
        "confirmed_at": datetime.utcnow().isoformat(),
        "groups": [g.model_dump() for g in entry_groups],
    })
    task.config = json.dumps(existing_config, ensure_ascii=False)

    await db.flush()

    return ImportConfirmResponse(
        task_id=task.id,
        status=task.status,
        imported_rows=imported_count,
        skipped_rows=skipped_count,
        total_confirmed=total_confirmed,
    )


# ─── 导入历史 ─────────────────────────

async def get_import_history(
    db: AsyncSession, book_id: str, user_id: str
) -> list[ImportTask]:
    """获取导入历史"""
    stmt = (
        select(ImportTask)
        .where(
            ImportTask.book_id == book_id,
            ImportTask.user_id == user_id,
        )
        .order_by(ImportTask.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ─── 撤销导入 ─────────────────────────

async def delete_import(
    db: AsyncSession,
    user: User,
    book_id: str,
    task_id: str,
) -> ImportDeleteResponse:
    """撤销导入：删除该 task 关联的所有分录"""
    task = await _get_task(db, task_id, book_id, user.id)

    # 读取 parsed_data 获取所有 external_id
    parsed_data = json.loads(task.parsed_data) if task.parsed_data else []
    external_ids = [
        row["external_id"] for row in parsed_data if row.get("external_id")
    ]

    # 批量删除 — 先删 journal_lines 再删 journal_entries
    if external_ids:
        # 查找所有关联的分录
        entries_stmt = select(JournalEntry.id).where(
            JournalEntry.book_id == book_id,
            JournalEntry.external_id.in_(external_ids),
        )
        entry_ids_result = await db.execute(entries_stmt)
        entry_ids = [row[0] for row in entry_ids_result.fetchall()]

        if entry_ids:
            # 删除 journal_lines
            await db.execute(
                delete(JournalLine).where(JournalLine.entry_id.in_(entry_ids))
            )
            # 删除 journal_entries
            await db.execute(
                delete(JournalEntry).where(JournalEntry.id.in_(entry_ids))
            )

        deleted_count = len(entry_ids)
    else:
        deleted_count = 0

    # 更新 task 状态
    task.status = "parsed"  # 回到初始状态
    task.imported_rows = 0
    task.skipped_rows = 0
    task.config = None
    await db.flush()

    return ImportDeleteResponse(deleted_count=deleted_count)


# ─── 内部辅助 ─────────────────────────

async def _get_task(
    db: AsyncSession, task_id: str, book_id: str, user_id: str
) -> ImportTask:
    stmt = select(ImportTask).where(
        ImportTask.id == task_id,
        ImportTask.book_id == book_id,
        ImportTask.user_id == user_id,
    )
    task = (await db.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "导入任务不存在")
    return task
```

### 4.3 微信账单解析器

**文件：`server/app/parsers/__init__.py`**

```python
"""账单解析器包"""
```

**文件：`server/app/parsers/wechat.py`**

```python
"""微信账单 xlsx 解析器

支持格式：微信「账单 → 导出账单」功能导出的 xlsx 文件。
文件结构：
  Row 0: "微信支付账单明细"（标识行）
  Row 1-14: 元信息/汇总/注释
  Row 15: 分隔线
  Row 16: 表头（交易时间|交易类型|交易对方|商品|收/支|金额(元)|支付方式|当前状态|交易单号|商户单号|备注）
  Row 17+: 数据行
"""

import io
from datetime import datetime

from openpyxl import load_workbook


# 成功状态关键词
SUCCESS_KEYWORDS = ("成功", "已存入", "已收钱", "已转账", "已到账")


def parse_wechat_xlsx(content: bytes) -> list[dict]:
    """解析微信账单 xlsx 文件内容，返回标准化行列表。

    Args:
        content: xlsx 文件的二进制内容

    Returns:
        list[dict]: 每个 dict 包含 date, description, amount, direction,
                    payment_method, external_id, is_duplicate(默认 False)

    Raises:
        ValueError: 非微信账单格式或无有效数据
    """
    wb = load_workbook(filename=io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        raise ValueError("无法读取工作表")

    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not rows:
        raise ValueError("文件为空")

    # 1. 校验标识行
    first_cell = str(rows[0][0]).strip() if rows[0][0] else ""
    if "微信支付账单明细" not in first_cell:
        raise ValueError("未找到「微信支付账单明细」标识，请确认文件为微信导出的账单")

    # 2. 定位表头行（找到第一列为"交易时间"的行）
    header_row_idx = None
    for i, row in enumerate(rows):
        cell = str(row[0]).strip() if row[0] else ""
        if cell == "交易时间":
            header_row_idx = i
            break

    if header_row_idx is None:
        raise ValueError("未找到表头行（交易时间列）")

    # 3. 解析数据行
    result = []
    for row_idx in range(header_row_idx + 1, len(rows)):
        row = rows[row_idx]
        if not row or not row[0]:
            continue

        # 列映射
        raw_time = str(row[0]).strip()       # 交易时间
        raw_type = str(row[1]).strip() if row[1] else ""  # 交易类型
        raw_party = str(row[2]).strip() if row[2] else ""  # 交易对方
        raw_goods = str(row[3]).strip() if row[3] else ""  # 商品
        raw_direction = str(row[4]).strip() if row[4] else ""  # 收/支
        raw_amount = str(row[5]).strip() if row[5] else "0"  # 金额(元)
        raw_payment = str(row[6]).strip() if row[6] else ""  # 支付方式
        raw_status = str(row[7]).strip() if row[7] else ""  # 当前状态
        raw_txn_id = str(row[8]).strip() if row[8] else ""  # 交易单号
        # row[9]: 商户单号（暂不使用）
        # row[10]: 备注（暂不使用）

        # 跳过非成功状态
        if not any(kw in raw_status for kw in SUCCESS_KEYWORDS):
            continue

        # 金额解析：去掉 ¥ 前缀，统一正数
        amount_str = raw_amount.replace("¥", "").replace(",", "").strip()
        try:
            amount = abs(float(amount_str))
        except ValueError:
            continue  # 跳过无法解析的行

        if amount == 0:
            continue

        # 描述生成
        if raw_goods and raw_goods != "/":
            description = f"{raw_party} - {raw_goods}"
        else:
            description = raw_party

        # external_id
        external_id = f"wechat_{raw_txn_id.strip()}"

        # 日期解析
        try:
            dt = datetime.strptime(raw_time, "%Y-%m-%d %H:%M:%S")
            date_str = dt.strftime("%Y-%m-%d")
        except ValueError:
            date_str = raw_time[:10]  # fallback

        result.append({
            "date": date_str,
            "description": description,
            "amount": amount,
            "direction": raw_direction,  # 保持原始值：支出 / 收入 / 中性交易
            "payment_method": raw_payment,
            "external_id": external_id,
            "is_duplicate": False,
        })

    return result
```

---

## 5. Router 层实现

### 5.1 Plugin Router 变更

**文件：`server/app/routers/plugins.py`** — 新增 `PUT /plugins/{plugin_id}/config`

在现有路由文件中新增：

```python
from app.schemas.plugin import PluginConfigUpdateRequest, PluginListResponse

# 修改列表接口使用 PluginListResponse（不含 config 详情）
@router.get("", response_model=list[PluginListResponse])
async def list_plugins(
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的所有插件。支持 JWT 或 API Key 认证。"""
    return await plugin_service.list_plugins(db, user.id)


# 新增：更新插件配置
@router.put("/{plugin_id}/config", response_model=PluginResponse)
async def update_config(
    plugin_id: str,
    body: PluginConfigUpdateRequest,
    book_id: str | None = None,  # query param，用于 account_select 校验
    user: User = Depends(get_current_user),  # 仅 JWT 认证
    db: AsyncSession = Depends(get_db),
):
    """更新插件配置。仅支持 JWT 认证（用户操作）。"""
    plugin = await plugin_service.update_plugin_config(
        db, plugin_id, user.id, body.config, book_id
    )
    return plugin
```

### 5.2 Import Router

**文件：`server/app/routers/import_router.py`**

```python
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.import_task import (
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportDeleteResponse,
    ImportHistoryItem,
    ImportUploadResponse,
)
from app.services import import_service
from app.utils.deps import get_current_user

router = APIRouter(prefix="/books/{book_id}/import", tags=["Import"])


@router.post("/upload", response_model=ImportUploadResponse)
async def upload_and_parse(
    book_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传微信账单 xlsx 文件并解析预览"""
    return await import_service.upload_and_parse(db, user, book_id, file)


@router.post("/{task_id}/confirm", response_model=ImportConfirmResponse)
async def confirm_import(
    book_id: str,
    task_id: str,
    body: ImportConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """确认导入选中的行（支持分批多次调用）"""
    return await import_service.confirm_import(
        db, user, book_id, task_id, body.entries
    )


@router.get("/history", response_model=list[ImportHistoryItem])
async def get_history(
    book_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取导入历史"""
    return await import_service.get_import_history(db, book_id, user.id)


@router.delete("/{task_id}", response_model=ImportDeleteResponse)
async def delete_import(
    book_id: str,
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """撤销导入：删除该任务关联的所有分录"""
    return await import_service.delete_import(db, user, book_id, task_id)
```

### 5.3 主应用注册

**文件：`server/app/main.py`** — 修改

```python
from app.routers import import_router

# 在现有路由注册后追加
app.include_router(import_router.router)
```

---

## 6. 前端实现

### 6.1 Import Service

**文件：`client/services/importService.ts`**

```typescript
import api from './api';

// ─── 类型定义 ─────────────────────────

export type ImportRowItem = {
  index: number;
  date: string;
  description: string;
  amount: number;
  direction: '支出' | '收入' | '中性交易';
  payment_method: string;
  external_id: string;
  is_duplicate: boolean;
};

export type ImportFilters = {
  directions: string[];
  payment_methods: string[];
};

export type ImportSummary = {
  income_count: number;
  income_total: number;
  expense_count: number;
  expense_total: number;
  neutral_count: number;
  neutral_total: number;
  duplicate_count: number;
};

export type ImportUploadResponse = {
  task_id: string;
  format: string;
  total_rows: number;
  rows: ImportRowItem[];
  filters: ImportFilters;
  summary: ImportSummary;
  status: string;
};

export type ImportConfirmEntryGroup = {
  indexes: number[];
  expense_account_id: string | null;
  income_account_id: string | null;
  payment_account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
};

export type ImportConfirmRequest = {
  entries: ImportConfirmEntryGroup[];
};

export type ImportConfirmResponse = {
  task_id: string;
  status: string;
  imported_rows: number;
  skipped_rows: number;
  total_confirmed: number;
};

export type ImportHistoryItem = {
  id: string;
  format: string;
  original_filename: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  status: string;
  created_at: string;
};

export type ImportDeleteResponse = {
  deleted_count: number;
};

// ─── API 方法 ─────────────────────────

export const importService = {
  upload: (bookId: string, file: FormData) =>
    api.post<ImportUploadResponse>(`/books/${bookId}/import/upload`, file, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  confirm: (bookId: string, taskId: string, body: ImportConfirmRequest) =>
    api.post<ImportConfirmResponse>(
      `/books/${bookId}/import/${taskId}/confirm`,
      body
    ),

  history: (bookId: string) =>
    api.get<ImportHistoryItem[]>(`/books/${bookId}/import/history`),

  delete: (bookId: string, taskId: string) =>
    api.delete<ImportDeleteResponse>(`/books/${bookId}/import/${taskId}`),
};
```

### 6.2 Plugin Service 变更

**文件：`client/services/pluginService.ts`** — 修改

```typescript
// 新增类型字段
export type PluginResponse = {
  id: string;
  name: string;
  type: string;
  api_key_id: string;
  description: string | null;
  last_sync_at: string | null;
  last_sync_status: string;
  last_error_message: string | null;
  sync_count: number;
  created_at: string;
  updated_at: string;
  // v0.4.1 新增
  config_schema: ConfigSchema | null;
  config: Record<string, any> | null;
  has_config: boolean;
  is_configured: boolean;
};

export type ConfigSchema = {
  fields: ConfigField[];
};

export type ConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'account_select' | 'secret';
  required?: boolean;
  default?: any;
  description?: string;
  options?: { label: string; value: string }[];
};

// 新增方法
export const pluginService = {
  list: () => api.get<PluginResponse[]>('/plugins'),
  get: (pluginId: string) => api.get<PluginResponse>(`/plugins/${pluginId}`),
  delete: (pluginId: string) => api.delete(`/plugins/${pluginId}`),

  // v0.4.1 新增
  updateConfig: (pluginId: string, config: Record<string, any>, bookId?: string) =>
    api.put<PluginResponse>(
      `/plugins/${pluginId}/config${bookId ? `?book_id=${bookId}` : ''}`,
      { config }
    ),
};
```

### 6.3 Profile 页面变更

**文件：`client/features/profile/types.ts`** — 修改

```typescript
export type DetailPane = 'none' | 'edit-profile' | 'settings' | 'about'
  | 'accounts' | 'assets' | 'loans' | 'budget' | 'api-keys'
  | 'plugins' | 'mcp' | 'book-settings'
  | 'data-import';  // v0.4.1 新增
```

**文件：`client/app/(tabs)/profile.tsx`** — 修改

```typescript
// 「数据导入/导出」菜单项：移除 hint="即将推出"，绑定 onPress
{
  icon: "swap-horizontal-outline",
  label: "数据导入/导出",
  onPress: () => handleMenuPress('data-import', '/settings/data-import'),
}
```

桌面端 `DetailPane` switch/case 中新增 `data-import` 渲染 `DataImportPane`。

### 6.4 DataImportPane 组件

**文件：`client/features/import/DataImportPane.tsx`**

核心逻辑：

1. 初始状态展示文件上传区域 + 导入历史列表
2. 用户选择文件后调用 `importService.upload()` 上传
3. 上传成功后切换到 `ImportPreview` 组件
4. 导入完成后刷新历史列表

```typescript
import { useState, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { importService, ImportUploadResponse, ImportHistoryItem } from '@/services/importService';
import { ImportPreview } from './ImportPreview';
import { ImportHistory } from './ImportHistory';

export function DataImportPane({ bookId }: { bookId: string }) {
  const [uploadResult, setUploadResult] = useState<ImportUploadResponse | null>(null);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = async () => {
    const res = await importService.history(bookId);
    setHistory(res.data);
  };

  useEffect(() => { loadHistory(); }, [bookId]);

  const handleUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (result.canceled) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', {
      uri: result.assets[0].uri,
      name: result.assets[0].name,
      type: result.assets[0].mimeType,
    } as any);

    const res = await importService.upload(bookId, formData);
    setUploadResult(res.data);
    setLoading(false);
  };

  if (uploadResult) {
    return (
      <ImportPreview
        bookId={bookId}
        data={uploadResult}
        onDone={() => { setUploadResult(null); loadHistory(); }}
        onCancel={() => setUploadResult(null)}
      />
    );
  }

  return (
    // 上传区域 + ImportHistory 组件
    // ...
  );
}
```

### 6.5 ImportPreview 组件

**文件：`client/features/import/ImportPreview.tsx`**

核心逻辑：

1. 接收 `ImportUploadResponse` 作为 props
2. 渲染 `ImportFilterBar`（direction + payment_method 筛选）
3. 维护 `selectedIndexes: Set<number>` 状态
4. 筛选后的行展示为带复选框的列表
5. 重复行（`is_duplicate`）默认不勾选，展示为灰色
6. 列表底部展示已选行数 + 科目选择器 + 确认按钮
7. 确认后调用 `importService.confirm()`
8. 导入成功的行标记为已导入，用户可继续筛选导入下一批

```typescript
const [filters, setFilters] = useState({
  direction: null as string | null,
  paymentMethod: null as string | null,
});
const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
const [importedIndexes, setImportedIndexes] = useState<Set<number>>(new Set());
const [targetAccountId, setTargetAccountId] = useState<string | null>(null);
const [paymentAccountId, setPaymentAccountId] = useState<string | null>(null);

// 筛选逻辑
const filteredRows = data.rows.filter(row => {
  if (importedIndexes.has(row.index)) return true; // 已导入的仍显示但灰色
  if (filters.direction && row.direction !== filters.direction) return false;
  if (filters.paymentMethod && row.payment_method !== filters.paymentMethod) return false;
  return true;
});

// 确认导入
const handleConfirm = async () => {
  const indexes = Array.from(selectedIndexes);
  const sampleRow = data.rows.find(r => selectedIndexes.has(r.index));
  const group = {
    indexes,
    expense_account_id: sampleRow?.direction === '支出' ? targetAccountId : null,
    income_account_id: sampleRow?.direction === '收入' ? targetAccountId : null,
    payment_account_id: (sampleRow?.direction === '支出' || sampleRow?.direction === '收入') ? paymentAccountId : null,
    from_account_id: sampleRow?.direction === '中性交易' ? fromAccountId : null,
    to_account_id: sampleRow?.direction === '中性交易' ? toAccountId : null,
  };
  await importService.confirm(bookId, data.task_id, { entries: [group] });
  setImportedIndexes(prev => new Set([...prev, ...indexes]));
  setSelectedIndexes(new Set());
};
```

### 6.6 ImportFilterBar 组件

**文件：`client/features/import/ImportFilterBar.tsx`**

筛选栏组件，渲染两行筛选按钮：

1. **收/支**：`[全部]` `[支出]` `[收入]` `[中性交易]`（从 `filters.directions` 动态生成）
2. **支付方式**：`[全部]` + `filters.payment_methods` 各项

使用 `ScrollView` + `Chip` / `Pressable` 样式的按钮，选中项高亮。

### 6.7 PluginConfigForm 组件

**文件：`client/features/plugin/PluginConfigForm.tsx`**

根据 `config_schema.fields` 动态渲染表单：

```typescript
export function PluginConfigForm({
  schema, config, onSave, loading
}: {
  schema: ConfigSchema;
  config: Record<string, any> | null;
  onSave: (config: Record<string, any>) => void;
  loading: boolean;
}) {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    // 初始值：已有 config > default > 空
    const initial: Record<string, any> = {};
    for (const field of schema.fields) {
      initial[field.key] = config?.[field.key] ?? field.default ?? null;
    }
    return initial;
  });

  const renderField = (field: ConfigField) => {
    switch (field.type) {
      case 'string':
      case 'secret':
        return <TextInput secureTextEntry={field.type === 'secret'} ... />;
      case 'number':
        return <TextInput keyboardType="numeric" ... />;
      case 'boolean':
        return <Switch ... />;
      case 'select':
        return <Picker items={field.options} ... />;
      case 'account_select':
        return <AccountSelector ... />;
    }
  };
  // ...
}
```

---

## 7. 开发实施计划

### 阶段 1：数据模型 & 迁移（预计 0.5 天）

1. `plugins` 模型新增 `config_schema` / `config` 字段
2. `import_task.py` 模型创建
3. `journal.py` 的 `source` 枚举新增 `"import"`
4. `models/__init__.py` 导入 `ImportTask`
5. `database.py` 追加 `_migrate_plugin_config`
6. `requirements.txt` 新增 `openpyxl`

### 阶段 2：插件配置后端（预计 1 天）

1. `schemas/plugin.py` 扩展（`PluginConfigUpdateRequest`、`PluginResponse` 新字段、`PluginListResponse`）
2. `plugin_service.py` 修改 `create_plugin` + 新增 `update_plugin_config`
3. `routers/plugins.py` 新增 `PUT /config` 端点，修改列表响应类型
5. `tests/` 增加测试用例：
   - 注册插件时上报 config_schema
   - 更新配置含校验（必填、类型、select 范围、account_select 存在性）
   - 重复注册不覆盖已有 config
   - 插件详情返回完整 config_schema 和 config
   - 列表返回 has_config / is_configured

### 阶段 3：微信账单解析器（预计 0.5 天）

1. `parsers/__init__.py` + `parsers/wechat.py`
5. `tests/` 增加测试用例：
   - 正常 xlsx 解析（标识行、表头定位、数据提取）
   - 金额去 ¥ 前缀、统一正数
   - 中性交易正常解析
   - 非成功状态行跳过
   - 描述生成（商品为 `/` 时只取交易对方）
   - external_id 格式正确
   - 非微信文件抛 ValueError
   - 空文件抛 ValueError

### 阶段 4：导入 API 后端（预计 1.5 天）

1. `schemas/import_task.py` 创建
2. `services/import_service.py` 实现（upload_and_parse, confirm_import, get_import_history, delete_import）
3. `routers/import_router.py` 创建
4. `main.py` 注册路由
5. `tests/` 增加测试用例：
   - 上传解析正常流程
   - 文件校验（非 xlsx / 超 10MB / 非微信格式）
   - 重复检测（is_duplicate 标记）
   - 分批确认导入（多次 confirm）
   - 幂等性（重复 confirm 不产生重复分录）
   - 支出/收入/中性交易三种分录创建
   - source 标记为 "import"
   - external_id 正确设置 
   - task 状态流转（parsed → partial → imported）
   - 撤销导入（删除关联分录，task 回到 parsed）
   - 导入历史列表

### 阶段 5：前端 — 插件配置 UI（预计 1.5 天）

1. `pluginService.ts` 类型扩展 + `updateConfig` 方法
2. `PluginConfigForm.tsx` 动态表单组件
3. `PluginsPane.tsx` 修改（配置状态、配置按钮、展开表单）
4. `app/settings/plugins.tsx` 修改（移动端配置状态 + 跳转）
5. `app/settings/plugin-config.tsx` 新建（移动端配置页）

### 阶段 6：前端 — 导入 UI（预计 2 天）

1. `importService.ts` 创建
2. `features/import/DataImportPane.tsx` 导入面板
3. `features/import/ImportPreview.tsx` 解析预览（含筛选、行选择、科目指定）
4. `features/import/ImportFilterBar.tsx` 筛选栏
5. `features/import/ImportHistory.tsx` 历史 + 撤销
6. `features/import/index.ts` 导出
7. `app/settings/data-import.tsx` 移动端页面
8. `profile.tsx` 激活入口 + 桌面端 DataImportPane 渲染
9. `features/profile/types.ts` 新增 `'data-import'`

### 阶段 7：联调 & 测试（预计 0.5 天）

1. 插件配置端到端（注册带 schema → 前端渲染 → 填写保存 → 插件读取）
2. 导入端到端（上传 → 筛选 → 分批选科目 → 确认 → 历史 → 撤销）
3. 幂等验证（同文件重复上传、同 task 重复 confirm）

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 数据模型 & 迁移 | 0.5 天 | 0.5 天 |
| 2 | 插件配置后端 | 1 天 | 1.5 天 |
| 3 | 微信账单解析器 | 0.5 天 | 2 天 |
| 4 | 导入 API 后端 | 1.5 天 | 3.5 天 |
| 5 | 前端插件配置 UI | 1.5 天 | 5 天 |
| 6 | 前端导入 UI | 2 天 | 7 天 |
| 7 | 联调 & 测试 | 0.5 天 | 7.5 天 |

> v0.4.1 总计约 **7.5 个工作日**。

---

## 8. 依赖变更

### 8.1 后端

| 包 | 版本 | 用途 | 状态 |
|----|------|------|------|
| `openpyxl` | `>=3.1.0` | 解析微信账单 xlsx | **新增** |

其余依赖复用现有。

### 8.2 前端

| 包 | 用途 | 状态 |
|----|------|------|
| `expo-document-picker` | 文件选择（导入 xlsx） | 需确认是否已安装 |

---

## 9. 测试要点

### 9.1 插件配置测试

| 测试用例 | 预期结果 |
|---------|---------|
| 注册插件带 config_schema | schema 正确存储 |
| 重复注册更新 schema | schema 更新，已有 config 不被覆盖 |
| 保存配置 — 正常 | config 正确存储，is_configured 变为 true |
| 保存配置 — 必填缺失 | 422 + 缺失字段列表 |
| 保存配置 — 类型不匹配 | 422 + 错误字段和期望类型 |
| 保存配置 — select 无效值 | 422 |
| 保存配置 — account_select 科目不存在 | 422 |
| 保存配置 — 未知字段 | 自动过滤，不报错 |
| 获取插件详情 | 返回完整 config_schema 和 config |
| 列表接口 | 返回 has_config / is_configured，不含 schema 详情 |
| 无 config_schema 的插件 | has_config = false，不显示配置按钮 |
| secret 类型回显 | 前端显示 `••••••••`，编辑时可重新输入 |
| default 值 | 未填写时 default 作为初始值 |

### 9.2 微信账单解析测试

| 测试用例 | 预期结果 |
|---------|---------|
| 正常 xlsx | 正确解析所有有效行 |
| 无标识行 | ValueError: 未找到微信支付账单明细 |
| 无表头行 | ValueError: 未找到表头行 |
| 空文件 | ValueError: 文件为空 |
| 金额带 ¥ 前缀 | 正确去掉，统一正数 |
| 中性交易行 | direction = "中性交易"，正常解析 |
| 非成功状态行 | 跳过 |
| 商品为 `/` | 描述只取交易对方 |
| external_id 格式 | `wechat_{交易单号}` |

### 9.3 导入 API 测试

| 测试用例 | 预期结果 |
|---------|---------|
| 上传非 xlsx | 400 |
| 上传超 10MB | 413 |
| 上传非微信文件 | 422 |
| 正常上传 | 返回全量行 + filters + summary |
| 重复检测 | is_duplicate = true（已有 external_id） |
| 确认导入支出行 | 创建 expense 分录（借费用贷资产），source = "import" |
| 确认导入收入行 | 创建 income 分录（借资产贷收入），source = "import" |
| 确认导入中性交易行 | 创建 transfer 分录，source = "import" |
| 支出行缺 expense_account_id | 422 |
| 支出行缺 payment_account_id | 422 |
| 收入行缺 payment_account_id | 422 |
| 中性交易行缺 from/to_account_id | 422 |
| 幂等：重复 confirm 同一行 | skipped，不产生重复分录 |
| 分批 confirm | 多次调用成功，task.imported_rows 累加 |
| 部分导入后 status | "partial" |
| 全部导入后 status | "imported" |
| 撤销导入 | 删除所有关联分录，task 回到 "parsed" |
| 撤销后再次导入 | 可以正常导入（external_id 已删除） |
| 导入历史 | 按 created_at 倒序，含所有字段 |

### 9.4 前端测试

| 测试用例 | 预期结果 |
|---------|---------|
| 插件配置表单渲染 | 根据 field.type 渲染对应控件 |
| 必填标记 | 必填字段标签后显示 `*` |
| 保存按钮禁用 | 必填未填时按钮不可点击 |
| 数据导入入口 | 菜单可点击，桌面端面板 / 移动端跳转 |
| 文件选择 | 只允许 xlsx |
| 上传 loading | 显示加载状态 |
| 预览列表 | 展示全量行，重复行灰色 |
| 筛选 | 按 direction / payment_method 过滤 |
| 行选择 | 全选/取消全选，逐行勾选 |
| 科目选择 | 复用科目选择组件 |
| 确认导入 | 调用 API，成功后标记已导入行 |
| 导入历史 | 展示历史记录，状态正确 |
| 撤销操作 | 确认弹窗 → 调用 API → 刷新列表 |

---

## 10. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| `config` 明文存储敏感信息 | 当前可接受（本地部署）；后续可加密 `secret` 类型字段 |
| 上传恶意文件 | 限制 `.xlsx` 后缀 + 文件大小 10MB；`openpyxl` 仅读取数据，不执行宏 |
| `config_schema` 注入 | 后端注册时校验 schema 结构（fields 数组、必要属性检查） |
| 大文件 OOM | 10MB 限制 + `openpyxl` read_only 模式 |
| 科目越权 | confirm 时校验科目属于指定 `book_id` 且该 book 属于当前用户 |
| 分录重放 | `external_id` 唯一约束保证幂等 |
| `parsed_data` 占用存储 | 确认导入全部完成后可清空 `parsed_data` 字段 |
