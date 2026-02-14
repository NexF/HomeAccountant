# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.2.0**
> **创建日期：2026-02-13**
> **基于版本：v0.1.1**
> **状态：规划中**
> **本版本变更：插件化外部数据同步（API Key 认证、批量记账 API、余额同步 API、插件管理、前端 API Key & 插件管理 UI）**

---

## 1. 技术架构概述

v0.2.0 新增后端 API Key 认证层、插件管理模块、批量记账和余额同步两套 API，同时新增前端 API Key 管理和插件管理 UI。

- **前端**：React Native + Expo + TypeScript + Zustand（新增 API Key 管理页面、插件管理页面、「我的」菜单扩展）
- **后端**：Python FastAPI + SQLAlchemy + SQLite（不变）

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **数据模型** | `server/app/models/api_key.py` | 新增 | API Key 模型 |
| **数据模型** | `server/app/models/plugin.py` | 新增 | 插件模型 |
| **数据模型** | `server/app/models/journal.py` | 修改 | `JournalEntry` 新增 `external_id` 字段 |
| **数据模型** | `server/app/models/__init__.py` | 修改 | 导入新模型 |
| **Schema** | `server/app/schemas/api_key.py` | 新增 | API Key 请求/响应 schema |
| **Schema** | `server/app/schemas/plugin.py` | 新增 | 插件请求/响应 schema |
| **Schema** | `server/app/schemas/entry.py` | 修改 | `EntryCreateRequest` 新增 `external_id` 可选字段 |
| **认证** | `server/app/utils/api_key_auth.py` | 新增 | API Key 认证依赖注入 |
| **Service** | `server/app/services/api_key_service.py` | 新增 | API Key CRUD 逻辑 |
| **Service** | `server/app/services/plugin_service.py` | 新增 | 插件管理逻辑 |
| **Service** | `server/app/services/batch_entry_service.py` | 新增 | 批量记账逻辑（事务、去重） |
| **Router** | `server/app/routers/api_keys.py` | 新增 | API Key 管理端点 |
| **Router** | `server/app/routers/plugins.py` | 新增 | 插件管理 + 批量记账 + 余额同步端点 |
| **Router** | `server/app/main.py` | 修改 | 注册新路由 |
| **前端 Service** | `client/services/apiKeyService.ts` | 新增 | API Key CRUD 请求封装 |
| **前端 Service** | `client/services/pluginService.ts` | 新增 | 插件查询/删除请求封装 |
| **前端页面** | `client/app/settings/api-keys.tsx` | 新增 | API Key 管理页面（移动端） |
| **前端页面** | `client/app/settings/plugins.tsx` | 新增 | 插件管理页面（移动端） |
| **前端组件** | `client/app/(tabs)/profile.tsx` | 修改 | 菜单新增 API Key 管理 & 插件管理入口，桌面端 DetailPane 扩展 |

---

## 2. 数据模型实现

### 2.1 `api_keys` 表

**文件：`server/app/models/api_key.py`**

```python
class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    key_prefix = Column(String(12), nullable=False, index=True)  # 前 8 位明文 + "hak_"
    key_hash = Column(String(128), nullable=False)  # bcrypt 哈希
    is_active = Column(Boolean, default=True, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)  # NULL = 永不过期
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # 关系
    user = relationship("User", backref="api_keys")
    plugins = relationship("Plugin", back_populates="api_key", cascade="all, delete-orphan")
```

### 2.2 `plugins` 表

**文件：`server/app/models/plugin.py`**

```python
class Plugin(Base):
    __tablename__ = "plugins"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    api_key_id = Column(String, ForeignKey("api_keys.id"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(10), nullable=False)  # entry / balance / both
    description = Column(Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String(10), default="idle")  # idle / running / success / failed
    last_error_message = Column(Text, nullable=True)
    sync_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # 同一用户下插件名称唯一
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_plugins_user_name"),
    )

    # 关系
    user = relationship("User", backref="plugins")
    api_key = relationship("ApiKey", back_populates="plugins")
```

### 2.3 `journal_entries` 表 — 新增字段

**文件：`server/app/models/journal.py`**

```python
class JournalEntry(Base):
    # ... 现有字段不变 ...

    # v0.2.0 新增
    external_id = Column(String(128), nullable=True)  # 外部唯一标识，用于幂等去重

    # 联合唯一索引：同一账本内 external_id 唯一
    __table_args__ = (
        # ... 保留现有索引 ...
        Index("ix_journal_entries_book_external",
              "book_id", "external_id",
              unique=True,
              postgresql_where=text("external_id IS NOT NULL")),  # 仅对非 NULL 值唯一
    )
```

> **注意**：SQLite 不支持 `postgresql_where` 部分索引。对于 SQLite，改用应用层校验：插入前查询 `SELECT id FROM journal_entries WHERE book_id = ? AND external_id = ?`。

### 2.4 数据库迁移

本版本新增 2 张表 + 1 个字段。由于项目使用 SQLAlchemy `create_all()` 建表（无 Alembic），需要：

1. 新增表：`create_all()` 会自动创建不存在的表
2. 新增字段：需要手动执行 `ALTER TABLE journal_entries ADD COLUMN external_id VARCHAR(128)`
3. 新增索引：需要手动执行 `CREATE UNIQUE INDEX IF NOT EXISTS ix_journal_entries_book_external ON journal_entries(book_id, external_id) WHERE external_id IS NOT NULL`

提供一个迁移脚本 `server/scripts/migrate_v0_2_0.py`。

---

## 3. API Key 认证实现

### 3.1 Key 生成算法

**文件：`server/app/services/api_key_service.py`**

```python
import secrets
from passlib.hash import bcrypt

def generate_api_key() -> tuple[str, str, str]:
    """生成 API Key，返回 (明文key, 前缀, 哈希)"""
    # 生成 32 字节随机数，编码为 URL-safe base64 (43 字符)
    raw = secrets.token_urlsafe(32)
    full_key = f"hak_{raw}"  # 总长度约 47 字符
    prefix = full_key[:12]    # "hak_" + 8字符
    key_hash = bcrypt.hash(full_key)
    return full_key, prefix, key_hash
```

### 3.2 Key 验证

**文件：`server/app/utils/api_key_auth.py`**

```python
from fastapi import Header, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User

async def get_api_user(
    authorization: str = Header(..., description="Bearer hak_xxx"),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, ApiKey]:
    """从 API Key 解析用户，返回 (user, api_key)"""

    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid authorization header")

    token = authorization[7:]  # 去掉 "Bearer "

    # 1. 用前缀缩小查找范围
    prefix = token[:12]
    stmt = select(ApiKey).where(
        ApiKey.key_prefix == prefix,
        ApiKey.is_active == True,
    )
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    # 2. bcrypt 验证
    from passlib.hash import bcrypt
    matched_key = None
    for key in candidates:
        if bcrypt.verify(token, key.key_hash):
            matched_key = key
            break

    if not matched_key:
        raise HTTPException(401, "Invalid API Key")

    # 3. 检查过期
    if matched_key.expires_at and matched_key.expires_at < datetime.utcnow():
        raise HTTPException(401, "API Key expired")

    # 4. 更新最后使用时间
    matched_key.last_used_at = datetime.utcnow()
    await db.flush()

    # 5. 加载关联用户
    user_stmt = select(User).where(User.id == matched_key.user_id)
    user = (await db.execute(user_stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    return user, matched_key
```

### 3.3 双认证支持

对于同时支持 JWT Token 和 API Key 的端点（如插件列表），创建组合依赖：

```python
async def get_current_user_flexible(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """支持 JWT Token 或 API Key 认证"""
    auth_header = request.headers.get("Authorization", "")

    if auth_header.startswith("Bearer hak_"):
        user, _ = await get_api_user(auth_header, db)
        return user
    else:
        return await get_current_user(request, db)  # 现有 JWT 认证
```

---

## 4. Schema 定义

### 4.1 API Key Schema

**文件：`server/app/schemas/api_key.py`**

```python
from pydantic import BaseModel, Field
from datetime import datetime

class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., max_length=100, description="Key 名称")
    expires_at: datetime | None = Field(None, description="过期时间，NULL 永不过期")

class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    key: str  # 明文 Key，仅在创建时返回！
    key_prefix: str
    is_active: bool
    expires_at: datetime | None
    created_at: datetime

class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str  # 注意：不返回明文 Key
    is_active: bool
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime

class ApiKeyUpdateRequest(BaseModel):
    is_active: bool | None = None
    name: str | None = Field(None, max_length=100)
```

### 4.2 Plugin Schema

**文件：`server/app/schemas/plugin.py`**

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal

class PluginCreateRequest(BaseModel):
    name: str = Field(..., max_length=100)
    type: Literal["entry", "balance", "both"]
    description: str | None = None

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

class PluginStatusUpdateRequest(BaseModel):
    status: Literal["running", "success", "failed"]
    error_message: str | None = None
```

### 4.3 批量记账 Schema

**文件：`server/app/schemas/plugin.py`**（同文件扩展）

```python
from app.schemas.entry import EntryCreateRequest

class BatchEntryItem(EntryCreateRequest):
    """单条批量记账记录，继承 EntryCreateRequest 并新增 external_id"""
    external_id: str | None = Field(None, max_length=128, description="外部唯一标识，用于去重")

class BatchEntryRequest(BaseModel):
    book_id: str
    entries: list[BatchEntryItem] = Field(..., max_length=200)

class BatchEntryResultItem(BaseModel):
    index: int
    external_id: str | None
    status: Literal["created", "skipped"]
    entry_id: str | None

class BatchEntryResponse(BaseModel):
    total: int
    created: int
    skipped: int
    results: list[BatchEntryResultItem]
```

### 4.4 余额同步 Schema

```python
class BalanceSyncItem(BaseModel):
    account_id: str
    balance: Decimal = Field(..., description="外部真实余额")
    snapshot_date: date

class BalanceSyncRequest(BaseModel):
    book_id: str
    snapshots: list[BalanceSyncItem]

class BalanceSyncResultItem(BaseModel):
    account_id: str
    account_name: str
    book_balance: Decimal
    external_balance: Decimal
    difference: Decimal
    status: Literal["balanced", "reconciliation_created"]
    reconciliation_entry_id: str | None
    snapshot_id: str | None

class BalanceSyncResponse(BaseModel):
    total: int
    results: list[BalanceSyncResultItem]
```

### 4.5 EntryCreateRequest 扩展

**文件：`server/app/schemas/entry.py`** — 修改

```python
class EntryCreateRequest(BaseModel):
    # ... 所有现有字段不变 ...

    # v0.2.0 新增（可选）
    external_id: str | None = Field(None, max_length=128, description="外部唯一标识，用于去重")
```

---

## 5. Service 层实现

### 5.1 API Key Service

**文件：`server/app/services/api_key_service.py`**

```python
async def create_api_key(
    db: AsyncSession, user_id: str, name: str, expires_at: datetime | None
) -> tuple[ApiKey, str]:
    """创建 API Key，返回 (模型对象, 明文key)"""
    full_key, prefix, key_hash = generate_api_key()
    api_key = ApiKey(
        user_id=user_id,
        name=name,
        key_prefix=prefix,
        key_hash=key_hash,
        expires_at=expires_at,
    )
    db.add(api_key)
    await db.flush()
    await db.refresh(api_key)
    return api_key, full_key

async def list_api_keys(db: AsyncSession, user_id: str) -> list[ApiKey]:
    stmt = select(ApiKey).where(ApiKey.user_id == user_id).order_by(ApiKey.created_at.desc())
    return (await db.execute(stmt)).scalars().all()

async def delete_api_key(db: AsyncSession, key_id: str, user_id: str) -> None:
    stmt = select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
    key = (await db.execute(stmt)).scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API Key not found")
    await db.delete(key)

async def update_api_key(
    db: AsyncSession, key_id: str, user_id: str, body: ApiKeyUpdateRequest
) -> ApiKey:
    stmt = select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
    key = (await db.execute(stmt)).scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API Key not found")
    if body.is_active is not None:
        key.is_active = body.is_active
    if body.name is not None:
        key.name = body.name
    await db.flush()
    await db.refresh(key)
    return key
```

### 5.2 Plugin Service

**文件：`server/app/services/plugin_service.py`**

```python
async def create_plugin(
    db: AsyncSession, user_id: str, api_key_id: str, body: PluginCreateRequest
) -> tuple[Plugin, bool]:
    """注册插件（幂等）。返回 (plugin, is_new)。
    同一用户下 name 相同的插件视为同一个，直接返回已有记录。
    """
    # 1. 按 user_id + name 查找已有插件
    stmt = select(Plugin).where(
        Plugin.user_id == user_id,
        Plugin.name == body.name,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        # 已存在：更新 api_key_id（允许换绑 Key）和 description/type
        existing.api_key_id = api_key_id
        if body.type:
            existing.type = body.type
        if body.description is not None:
            existing.description = body.description
        existing.updated_at = datetime.utcnow()
        await db.flush()
        await db.refresh(existing)
        return existing, False  # is_new = False

    # 2. 不存在：创建新插件
    plugin = Plugin(
        user_id=user_id,
        api_key_id=api_key_id,
        name=body.name,
        type=body.type,
        description=body.description,
    )
    db.add(plugin)
    await db.flush()
    await db.refresh(plugin)
    return plugin, True  # is_new = True

async def update_plugin_status(
    db: AsyncSession, plugin_id: str, user_id: str, body: PluginStatusUpdateRequest
) -> Plugin:
    plugin = await _get_plugin(db, plugin_id, user_id)

    plugin.last_sync_status = body.status
    if body.status == "success":
        plugin.last_sync_at = datetime.utcnow()
        plugin.sync_count += 1
        plugin.last_error_message = None
    elif body.status == "failed":
        plugin.last_sync_at = datetime.utcnow()
        plugin.last_error_message = body.error_message
    # "running" 状态只更新 status，不更新 sync_at

    plugin.updated_at = datetime.utcnow()
    await db.flush()
    await db.refresh(plugin)
    return plugin
```

### 5.3 Batch Entry Service

**文件：`server/app/services/batch_entry_service.py`**

核心逻辑：在一个事务中遍历所有条目，逐条调用现有 `entry_service` 的创建逻辑，遇到错误则整个事务回滚。

```python
async def batch_create_entries(
    db: AsyncSession,
    user: User,
    book_id: str,
    entries: list[BatchEntryItem],
) -> BatchEntryResponse:
    """批量创建分录，事务性保证"""

    # 1. 校验 book 归属
    book = await _validate_book_access(db, book_id, user)

    results = []
    created_count = 0
    skipped_count = 0

    for idx, item in enumerate(entries):
        # 2. 检查 external_id 去重
        if item.external_id:
            existing = await _find_by_external_id(db, book_id, item.external_id)
            if existing:
                results.append(BatchEntryResultItem(
                    index=idx,
                    external_id=item.external_id,
                    status="skipped",
                    entry_id=existing.id,
                ))
                skipped_count += 1
                continue

        # 3. 调用现有的分录创建逻辑
        try:
            entry = await _create_single_entry(db, user, book, item)
            # 4. 设置 external_id
            if item.external_id:
                entry.external_id = item.external_id
            # 5. 标记 source = sync
            entry.source = "sync"
            await db.flush()

            results.append(BatchEntryResultItem(
                index=idx,
                external_id=item.external_id,
                status="created",
                entry_id=entry.id,
            ))
            created_count += 1

        except Exception as e:
            # 6. 任何一条失败 → 抛异常，上层 router 会回滚事务
            raise HTTPException(400, detail={
                "message": f"第 {idx + 1} 条分录创建失败: {str(e)}",
                "index": idx,
                "external_id": item.external_id,
            })

    return BatchEntryResponse(
        total=len(entries),
        created=created_count,
        skipped=skipped_count,
        results=results,
    )
```

**`_create_single_entry` 复用现有逻辑**：

```python
async def _create_single_entry(
    db: AsyncSession, user: User, book: Book, item: BatchEntryItem
) -> JournalEntry:
    """复用现有 entry_service 的分录创建逻辑"""
    # 将 BatchEntryItem 转换为 EntryCreateRequest（它是子类，直接兼容）
    # 调用 entry_service 中对应 entry_type 的创建函数
    from app.services.entry_service import (
        create_expense_entry, create_income_entry,
        create_transfer_entry, create_asset_purchase_entry,
        create_borrow_entry, create_repay_entry,
    )

    match item.entry_type:
        case "expense":
            return await create_expense_entry(db, user, book, item)
        case "income":
            return await create_income_entry(db, user, book, item)
        case "transfer":
            return await create_transfer_entry(db, user, book, item)
        case "asset_purchase":
            return await create_asset_purchase_entry(db, user, book, item)
        case "borrow":
            return await create_borrow_entry(db, user, book, item)
        case "repay":
            return await create_repay_entry(db, user, book, item)
        case _:
            raise ValueError(f"批量导入不支持的分录类型: {item.entry_type}")
```

> **注意**：批量导入不支持 `manual` 类型（手动分录）和联动实体创建（固定资产折旧设置、贷款设置等）。仅支持基本的 6 种快捷记账类型。

### 5.4 Balance Sync Service

**文件复用**：`server/app/services/reconciliation_service.py`（现有）

余额同步的底层逻辑与现有手动对账完全一致，只需在 router 层做循环调用：

```python
async def batch_sync_balance(
    db: AsyncSession,
    user: User,
    book_id: str,
    snapshots: list[BalanceSyncItem],
) -> BalanceSyncResponse:
    """批量余额同步"""
    book = await _validate_book_access(db, book_id, user)
    results = []

    for item in snapshots:
        # 复用现有 reconciliation_service 的逻辑
        account = await _validate_account(db, item.account_id, book_id)
        book_balance = await _calculate_book_balance(db, item.account_id, item.snapshot_date)
        difference = item.balance - book_balance

        # 创建快照记录
        snapshot = BalanceSnapshot(
            data_source_id=None,  # 插件同步不一定有 data_source
            account_id=item.account_id,
            snapshot_date=item.snapshot_date,
            external_balance=item.balance,
            book_balance=book_balance,
            difference=difference,
        )

        reconciliation_entry_id = None
        if difference != 0:
            # 生成调节分录（复用现有逻辑）
            entry = await _generate_reconciliation_entry(
                db, user, book, account, difference, item.snapshot_date
            )
            entry.source = "sync"
            reconciliation_entry_id = entry.id
            snapshot.status = "pending"
            snapshot.reconciliation_entry_id = entry.id
        else:
            snapshot.status = "balanced"

        db.add(snapshot)
        await db.flush()

        results.append(BalanceSyncResultItem(
            account_id=item.account_id,
            account_name=account.name,
            book_balance=book_balance,
            external_balance=item.balance,
            difference=difference,
            status="reconciliation_created" if difference != 0 else "balanced",
            reconciliation_entry_id=reconciliation_entry_id,
            snapshot_id=snapshot.id,
        ))

    return BalanceSyncResponse(total=len(snapshots), results=results)
```

---

## 6. Router 层实现

### 6.1 API Key Router

**文件：`server/app/routers/api_keys.py`**

```python
router = APIRouter(prefix="/api-keys", tags=["API Keys"])

@router.post("", response_model=ApiKeyCreateResponse)
async def create_key(
    body: ApiKeyCreateRequest,
    user: User = Depends(get_current_user),  # JWT 认证
    db: AsyncSession = Depends(get_db),
):
    api_key, plain_key = await api_key_service.create_api_key(
        db, user.id, body.name, body.expires_at
    )
    await db.commit()
    return ApiKeyCreateResponse(
        id=api_key.id,
        name=api_key.name,
        key=plain_key,  # 仅此一次返回明文
        key_prefix=api_key.key_prefix,
        is_active=api_key.is_active,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
    )

@router.get("", response_model=list[ApiKeyResponse])
async def list_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    keys = await api_key_service.list_api_keys(db, user.id)
    return keys

@router.patch("/{key_id}", response_model=ApiKeyResponse)
async def update_key(
    key_id: str,
    body: ApiKeyUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await api_key_service.update_api_key(db, key_id, user.id, body)
    await db.commit()
    return key

@router.delete("/{key_id}", status_code=204)
async def delete_key(
    key_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await api_key_service.delete_api_key(db, key_id, user.id)
    await db.commit()
```

### 6.2 Plugin Router

**文件：`server/app/routers/plugins.py`**

```python
router = APIRouter(prefix="/plugins", tags=["Plugins"])

# ─── 插件管理 ─────────────────────────

@router.post("", response_model=PluginResponse)
async def register_plugin(
    body: PluginCreateRequest,
    response: Response,
    auth: tuple[User, ApiKey] = Depends(get_api_user),  # API Key 认证
    db: AsyncSession = Depends(get_db),
):
    user, api_key = auth
    plugin, is_new = await plugin_service.create_plugin(db, user.id, api_key.id, body)
    await db.commit()
    response.status_code = 201 if is_new else 200  # 新建 201，已存在 200
    return plugin

@router.get("", response_model=list[PluginResponse])
async def list_plugins(
    user: User = Depends(get_current_user_flexible),  # JWT 或 API Key
    db: AsyncSession = Depends(get_db),
):
    return await plugin_service.list_plugins(db, user.id)

@router.get("/{plugin_id}", response_model=PluginResponse)
async def get_plugin(
    plugin_id: str,
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    return await plugin_service.get_plugin(db, plugin_id, user.id)

@router.put("/{plugin_id}/status", response_model=PluginResponse)
async def update_status(
    plugin_id: str,
    body: PluginStatusUpdateRequest,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    user, _ = auth
    plugin = await plugin_service.update_plugin_status(db, plugin_id, user.id, body)
    await db.commit()
    return plugin

@router.delete("/{plugin_id}", status_code=204)
async def delete_plugin(
    plugin_id: str,
    user: User = Depends(get_current_user),  # 仅 JWT 认证
    db: AsyncSession = Depends(get_db),
):
    await plugin_service.delete_plugin(db, plugin_id, user.id)
    await db.commit()

# ─── 批量记账 API ─────────────────────────

@router.post("/{plugin_id}/entries/batch", response_model=BatchEntryResponse)
async def batch_create_entries(
    plugin_id: str,
    body: BatchEntryRequest,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    user, _ = auth

    # 校验 plugin 归属
    plugin = await plugin_service.get_plugin(db, plugin_id, user.id)

    # 批量创建（整个函数在一个事务中）
    result = await batch_entry_service.batch_create_entries(
        db, user, body.book_id, body.entries
    )

    # 更新插件状态
    plugin.last_sync_at = datetime.utcnow()
    plugin.last_sync_status = "success"
    plugin.sync_count += 1
    plugin.last_error_message = None

    await db.commit()
    return result

# ─── 余额同步 API ─────────────────────────

@router.post("/{plugin_id}/balance/sync", response_model=BalanceSyncResponse)
async def sync_balance(
    plugin_id: str,
    body: BalanceSyncRequest,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    user, _ = auth

    plugin = await plugin_service.get_plugin(db, plugin_id, user.id)

    result = await batch_entry_service.batch_sync_balance(
        db, user, body.book_id, body.snapshots
    )

    # 更新插件状态
    plugin.last_sync_at = datetime.utcnow()
    plugin.last_sync_status = "success"
    plugin.sync_count += 1
    plugin.last_error_message = None

    await db.commit()
    return result
```

### 6.3 错误处理

批量 API 的事务回滚通过 FastAPI 的异常处理机制实现：

```python
@router.post("/{plugin_id}/entries/batch", response_model=BatchEntryResponse)
async def batch_create_entries(...):
    try:
        result = await batch_entry_service.batch_create_entries(...)
        await db.commit()
        return result
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()

        # 更新插件状态为失败
        plugin.last_sync_status = "failed"
        plugin.last_error_message = str(e)
        plugin.last_sync_at = datetime.utcnow()
        await db.commit()

        raise HTTPException(500, detail=str(e))
```

---

## 7. 主应用注册

**文件：`server/app/main.py`** — 修改

```python
from app.routers import api_keys, plugins

app.include_router(api_keys.router)
app.include_router(plugins.router)
```

---

## 8. 开发实施计划

### 阶段 1：数据模型 & API Key（预计 1 天）

1. 新增 `api_keys` 模型和 schema
2. 实现 API Key 生成/验证逻辑
3. 实现 `get_api_user` 认证依赖
4. 实现 API Key CRUD router
5. `journal_entries` 表新增 `external_id` 字段
6. 迁移脚本
7. 单元测试：Key 创建、验证、停用、过期

### 阶段 2：插件管理（预计 0.5 天）

1. 新增 `plugins` 模型和 schema
2. 实现插件 CRUD service
3. 实现插件 router（注册、列表、状态上报、删除）
4. 单元测试

### 阶段 3：批量记账 API（预计 2 天）

1. 实现 `BatchEntryItem` schema（继承 `EntryCreateRequest` + `external_id`）
2. 实现 `batch_create_entries` service（事务、去重）
3. 实现 router 端点
4. 单元测试：
   - 正常批量创建
   - `external_id` 去重（跳过已存在的）
   - 科目不存在 → 整体回滚
   - 借贷不平衡 → 整体回滚
   - 超过 200 条限制
   - 6 种 entry_type 的批量创建

### 阶段 4：余额同步 API（预计 1 天）

1. 实现余额同步 schema
2. 实现 `batch_sync_balance` service（复用 reconciliation_service）
3. 实现 router 端点
4. 单元测试：
   - 余额无差异 → balanced
   - 余额减少 → 生成待分类费用调节分录
   - 余额增加 → 生成待分类收入调节分录
   - 批量多科目同步
   - 投资类科目自动确认

### 阶段 5：前端 — API Key 管理 UI（预计 1 天）

1. 实现 `client/services/apiKeyService.ts`（CRUD 请求封装）
2. 实现 `client/app/settings/api-keys.tsx`（移动端页面）
3. `profile.tsx` 新增 `ApiKeysPane` 桌面端面板组件
4. `profile.tsx` 菜单新增「API Key 管理」入口
5. 创建 Key 后明文展示 + 复制功能
6. 停用/启用切换、删除确认 Modal

### 阶段 6：前端 — 插件管理 UI（预计 1 天）

1. 实现 `client/services/pluginService.ts`（查询/删除请求封装）
2. 实现 `client/app/settings/plugins.tsx`（移动端页面）
3. `profile.tsx` 新增 `PluginsPane` 桌面端面板组件
4. `profile.tsx` 菜单新增「插件管理」入口
5. 插件卡片：状态指示灯、同步次数、错误信息展示
6. 删除确认 Modal

### 阶段 7：联调 & 文档（预计 0.5 天）

1. Swagger UI 端到端测试
2. API Key 全流程测试（创建 Key → 注册插件 → 批量记账 → 余额同步 → 状态上报）
3. 前端联调（API Key 创建/复制/停用/删除、插件列表/删除）
4. 数据库事务边界验证

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 数据模型 & API Key | 1 天 | 1 天 |
| 2 | 插件管理 | 0.5 天 | 1.5 天 |
| 3 | 批量记账 API | 2 天 | 3.5 天 |
| 4 | 余额同步 API | 1 天 | 4.5 天 |
| 5 | 前端 API Key 管理 UI | 1 天 | 5.5 天 |
| 6 | 前端插件管理 UI | 1 天 | 6.5 天 |
| 7 | 联调 & 文档 | 0.5 天 | 7 天 |

> v0.2.0 总计约 **7 个工作日**。

---

## 9. 依赖变更

### 9.1 后端

| 包 | 版本 | 用途 | 状态 |
|----|------|------|------|
| `passlib[bcrypt]` | 已安装 | API Key 哈希 | 复用（已用于密码哈希） |

无新增依赖。

### 9.2 前端

| 包 | 用途 | 状态 |
|----|------|------|
| `expo-clipboard` | 创建 Key 后复制明文到剪贴板 | 需确认是否已安装 |

其余依赖复用现有。

---

## 10. 测试要点

### 10.1 API Key 测试

| 测试用例 | 预期结果 |
|---------|---------|
| 创建 Key → 返回明文 | 明文以 `hak_` 开头 |
| 列出 Key → 不含明文 | `key` 字段不在列表响应中 |
| 用 Key 调用 API | 鉴权通过，`last_used_at` 更新 |
| 停用 Key 后调用 | 401 Unauthorized |
| 过期 Key 调用 | 401 Unauthorized |
| 删除 Key → 关联插件级联删除 | 插件记录一并删除 |

### 10.2 批量记账测试

| 测试用例 | 预期结果 |
|---------|---------|
| 5 条正常 expense 分录 | 全部创建成功 |
| 含重复 `external_id` | 重复的跳过，其余创建 |
| 第 3 条科目不存在 | 全部回滚，返回错误指向第 3 条 |
| 超过 200 条 | 422 Validation Error |
| 6 种 entry_type 混合 | 全部正确创建 |
| 创建的分录 `source` 字段 | 为 `sync` |
| 创建的分录 `external_id` 字段 | 正确存储 |
| 分录列表中 `external_id` 过滤 | 可按 `external_id` 查询 |

### 10.3 余额同步测试

| 测试用例 | 预期结果 |
|---------|---------|
| 余额无差异 | status=balanced，无调节分录 |
| 银行余额减少 500 | 生成 `借：待分类费用 500 / 贷：银行存款 500` |
| 银行余额增加 1000 | 生成 `借：银行存款 1000 / 贷：待分类收入 1000` |
| 信用卡负债增加 | 生成 `借：待分类费用 / 贷：信用卡` |
| 投资类市值变动 | 自动确认，不入待处理队列 |
| 同一科目连续两次同步 | 第二次基于新的账本余额计算差额 |
| 调节分录的 `source` 字段 | 为 `sync` |
| 快照记录正确 | `balance_snapshots` 表记录完整 |

### 10.4 插件状态测试

| 测试用例 | 预期结果 |
|---------|---------|
| 注册插件 | 创建成功，status=idle |
| 上报 running | status 变为 running |
| 上报 success | status=success, last_sync_at 更新, sync_count+1 |
| 上报 failed + error_message | status=failed, error_message 记录 |
| 批量记账成功后 | 插件 status 自动更新为 success |

---

## 11. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| API Key 泄露 | Key 以 bcrypt 哈希存储；明文仅创建时返回一次；支持随时停用/删除 |
| 暴力猜测 Key | Key 长度 47 字符，随机生成，熵足够高；可加速率限制 |
| Key 前缀碰撞 | 前缀仅用于缩小范围，最终靠 bcrypt 验证确认 |
| 事务超时 | 批量限制 200 条上限；单次事务控制在合理时间内 |
| 科目越权 | 校验科目属于指定 `book_id` 且该 book 属于当前 Key 的用户 |
| 批量请求重放 | `external_id` 去重机制防止重复入账 |

---

## 12. 插件开发指南（面向插件开发者）

### 12.1 典型插件工作流程

```
1. 创建 API Key（通过 Web UI 或 API）
2. 注册插件（POST /plugins）
3. 定时执行：
   a. 上报状态 running（PUT /plugins/{id}/status）
   b. 爬取银行数据
   c. 构造 entries 列表（含 external_id 用于去重）
   d. 批量提交（POST /plugins/{id}/entries/batch）
   e. 同步余额（POST /plugins/{id}/balance/sync）
   f. 上报状态 success 或 failed
```

### 12.2 `external_id` 生成建议

```python
import hashlib

def make_external_id(date: str, amount: str, description: str, source: str) -> str:
    """生成去重用的 external_id"""
    raw = f"{date}|{amount}|{description}|{source}"
    return hashlib.sha256(raw.encode()).hexdigest()
```

### 12.3 科目 ID 获取

插件需要知道目标科目的 ID。可以通过：

1. 调用 `GET /books/{id}/accounts` 获取科目树
2. 在插件配置文件中硬编码科目 ID 映射

> 建议插件在首次运行时拉取科目树并缓存。
