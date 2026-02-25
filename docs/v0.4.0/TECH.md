# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.0**
> **创建日期：2026-02-25**
> **基于版本：v0.3.1**
> **状态：规划中**
> **本版本变更：管理后台（密码验证 + 用户管理 + 系统概览）**

---

## 1. 技术架构概述

v0.4.0 新增一个独立的管理后台，通过管理密码验证（非用户角色），支持系统数据概览、用户管理（编辑/封禁）和账本概览（只读）。

- **后端**：Python FastAPI + SQLAlchemy + SQLite（新增 8 个端点 + admin 鉴权依赖）
- **前端**：React Native + Expo + TypeScript（新增 admin 路由组 + 5 个页面）

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Config** | `server/app/config.py` | 修改 | 新增 `ADMIN_PASSWORD` 配置项 |
| **Model** | `server/app/models/user.py` | 修改 | 新增 `is_active`、`last_active_at` 字段 |
| **DB** | `server/app/database.py` | 修改 | 新增 `_migrate_users_admin` 迁移函数 |
| **Security** | `server/app/utils/security.py` | 修改 | 新增 `create_admin_token`、`decode_admin_token` |
| **Deps** | `server/app/utils/deps.py` | 修改 | 新增 `require_admin_token` 依赖，修改 `get_current_user` 增加 `is_active` 校验 |
| **Router** | `server/app/routers/auth.py` | 修改 | 登录时更新 `last_active_at` |
| **Router** | `server/app/main.py` | 修改 | 注册 admin 路由 |
| **Schema** | `server/app/schemas/admin.py` | 新增 | Admin 相关请求/响应 Schema |
| **Service** | `server/app/services/admin_service.py` | 新增 | Admin 业务逻辑（统计/用户管理/账本列表） |
| **Router** | `server/app/routers/admin.py` | 新增 | Admin API 8 个端点 |
| **测试** | `server/tests/test_admin.py` | 新增 | Admin 全部接口测试 |
| **前端 Service** | `client/services/adminService.ts` | 新增 | Admin API 服务层 |
| **前端 Store** | `client/stores/adminStore.ts` | 新增 | Admin 状态管理（token 仅内存） |
| **前端布局** | `client/app/_layout.tsx` | 修改 | Stack 注册 admin 路由，auth guard 排除 admin |
| **前端页面** | `client/app/admin/_layout.tsx` | 新增 | 管理后台布局 + token 守卫 + 导航 |
| **前端页面** | `client/app/admin/index.tsx` | 新增 | 概览仪表板 |
| **前端页面** | `client/app/admin/users.tsx` | 新增 | 用户列表 |
| **前端页面** | `client/app/admin/user/[id].tsx` | 新增 | 用户详情/编辑 |
| **前端页面** | `client/app/admin/books.tsx` | 新增 | 账本列表 |

### 1.2 无需变更

| 文件 | 说明 |
|------|------|
| `server/app/models/book.py` | 账本模型不改动，只做只读查询 |
| `server/app/models/journal.py` | 分录模型不改动，只做 COUNT 统计 |
| `server/app/services/auth_service.py` | 注册/登录逻辑不变（is_active 校验在 deps 层） |
| `server/app/schemas/auth.py` | 用户 Schema 不变，admin 有独立 Schema |

---

## 2. 后端 Config 变更

### 2.1 config.py 新增

```python
# server/app/config.py

class Settings(BaseSettings):
    # ... 现有配置 ...

    # 管理后台密码（为空则管理后台不可用）
    ADMIN_PASSWORD: str = ""
```

---

## 3. 后端 Model 变更

### 3.1 User 模型新增字段

```python
# server/app/models/user.py
from sqlalchemy import String, DateTime, Boolean

class User(Base):
    __tablename__ = "users"

    # ... 现有字段 ...

    # v0.4.0 新增
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

### 3.2 数据库迁移

```python
# server/app/database.py

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_budgets(conn)
        await _migrate_journal_external_id(conn)
        await _migrate_users_admin(conn)  # v0.4.0 新增


async def _migrate_users_admin(conn):
    """为 users 表补充 v0.4.0 新增的 is_active 和 last_active_at 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}

    migrations = [
        ("is_active", "ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"),
        ("last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP"),
    ]
    for col_name, sql in migrations:
        if col_name not in columns:
            await conn.execute(text(sql))
```

---

## 4. 后端 Security 变更

### 4.1 Admin Token 工具

```python
# server/app/utils/security.py

ADMIN_TOKEN_EXPIRE_MINUTES = 120  # 2 小时


def create_admin_token() -> str:
    """签发 admin JWT，有效期 2h"""
    expire = datetime.utcnow() + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES)
    payload = {
        "type": "admin",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_admin_token(token: str) -> bool:
    """验证 admin JWT，合法返回 True"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload.get("type") == "admin"
    except JWTError:
        return False
```

与用户 token 的区别：payload 中 `type == "admin"`，无 `sub` 字段，有效期仅 2h（用户 token 7 天）。

---

## 5. 后端 Deps 变更

### 5.1 新增 require_admin_token

```python
# server/app/utils/deps.py
from fastapi import Header

from app.config import settings
from app.utils.security import decode_admin_token


async def require_admin_token(
    x_admin_token: str = Header(..., alias="X-Admin-Token"),
) -> None:
    """从 X-Admin-Token 请求头提取并验证 admin JWT"""
    if not settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=404)
    if not decode_admin_token(x_admin_token):
        raise HTTPException(status_code=401, detail="admin token 无效或已过期")
```

### 5.2 修改 get_current_user

```python
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exception

    from app.services.auth_service import get_user_by_id
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise credentials_exception

    # v0.4.0: 封禁用户校验
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账户已被封禁")

    return user
```

---

## 6. 后端 Schema

### 6.1 新建 schemas/admin.py

```python
# server/app/schemas/admin.py
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Generic, TypeVar

T = TypeVar("T")


# ---- 请求 ----

class AdminLoginRequest(BaseModel):
    password: str = Field(..., description="管理密码")


class AdminUserUpdate(BaseModel):
    nickname: str | None = Field(None, max_length=100, description="昵称")


# ---- 响应 ----

class AdminLoginResponse(BaseModel):
    admin_token: str
    expires_in: int = Field(description="过期时间（秒）")


class AdminStatsResponse(BaseModel):
    total_users: int
    active_users: int
    banned_users: int
    total_books: int
    personal_books: int
    family_books: int
    total_entries: int
    today_new_users: int
    today_new_entries: int
    weekly_active_users: int


class AdminUserItem(BaseModel):
    id: str
    email: str
    nickname: str | None
    avatar_url: str | None
    is_active: bool
    book_count: int
    created_at: datetime
    last_active_at: datetime | None

    model_config = {"from_attributes": True}


class AdminUserDetail(AdminUserItem):
    """用户详情（与列表项字段相同，可扩展）"""
    pass


class AdminBookItem(BaseModel):
    id: str
    name: str
    type: str
    owner_email: str
    owner_nickname: str | None
    member_count: int
    entry_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
```

---

## 7. 后端 Service

### 7.1 新建 services/admin_service.py

```python
# server/app/services/admin_service.py
from datetime import datetime, timedelta

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.book import Book, BookMember
from app.models.journal import JournalEntry


async def get_stats(db: AsyncSession) -> dict:
    """聚合查询系统概览统计"""
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    # 用户统计
    user_stats = await db.execute(
        select(
            func.count(User.id).label("total"),
            func.count(case((User.is_active == True, 1))).label("active"),
            func.count(case((User.is_active == False, 1))).label("banned"),
        )
    )
    u = user_stats.one()

    # 账本统计
    book_stats = await db.execute(
        select(
            func.count(Book.id).label("total"),
            func.count(case((Book.type == "personal", 1))).label("personal"),
            func.count(case((Book.type == "family", 1))).label("family"),
        )
    )
    b = book_stats.one()

    # 分录总数
    entry_total = await db.execute(select(func.count(JournalEntry.id)))

    # 今日新增用户
    today_users = await db.execute(
        select(func.count(User.id)).where(User.created_at >= today_start)
    )

    # 今日新增分录
    today_entries = await db.execute(
        select(func.count(JournalEntry.id)).where(JournalEntry.created_at >= today_start)
    )

    # 7 天活跃用户（有 last_active_at 且在 7 天内）
    weekly_active = await db.execute(
        select(func.count(User.id)).where(
            and_(User.last_active_at.isnot(None), User.last_active_at >= week_ago)
        )
    )

    return {
        "total_users": u.total,
        "active_users": u.active,
        "banned_users": u.banned,
        "total_books": b.total,
        "personal_books": b.personal,
        "family_books": b.family,
        "total_entries": entry_total.scalar(),
        "today_new_users": today_users.scalar(),
        "today_new_entries": today_entries.scalar(),
        "weekly_active_users": weekly_active.scalar(),
    }


async def list_users(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
    status: str | None = None,
) -> tuple[list[dict], int]:
    """用户分页列表，返回 (items, total)"""
    # 子查询：每用户的账本数
    book_count_sub = (
        select(Book.owner_id, func.count(Book.id).label("book_count"))
        .group_by(Book.owner_id)
        .subquery()
    )

    query = (
        select(User, func.coalesce(book_count_sub.c.book_count, 0).label("book_count"))
        .outerjoin(book_count_sub, User.id == book_count_sub.c.owner_id)
    )

    count_query = select(func.count(User.id))

    # 搜索过滤
    if search:
        like = f"%{search}%"
        search_filter = User.email.ilike(like) | User.nickname.ilike(like)
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # 状态过滤
    if status == "active":
        query = query.where(User.is_active == True)
        count_query = count_query.where(User.is_active == True)
    elif status == "banned":
        query = query.where(User.is_active == False)
        count_query = count_query.where(User.is_active == False)

    # 总数
    total = (await db.execute(count_query)).scalar()

    # 分页
    query = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)

    items = []
    for user, book_count in result.all():
        items.append({
            "id": user.id,
            "email": user.email,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "is_active": user.is_active,
            "book_count": book_count,
            "created_at": user.created_at,
            "last_active_at": user.last_active_at,
        })

    return items, total


async def get_user_detail(db: AsyncSession, user_id: str) -> dict | None:
    """单用户详情"""
    book_count_sub = (
        select(func.count(Book.id)).where(Book.owner_id == user_id).scalar_subquery()
    )
    result = await db.execute(
        select(User, book_count_sub.label("book_count")).where(User.id == user_id)
    )
    row = result.one_or_none()
    if not row:
        return None
    user, book_count = row
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "is_active": user.is_active,
        "book_count": book_count,
        "created_at": user.created_at,
        "last_active_at": user.last_active_at,
    }


async def update_user(db: AsyncSession, user_id: str, nickname: str | None) -> dict | None:
    """修改用户昵称"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    if nickname is not None:
        user.nickname = nickname
    await db.flush()
    return await get_user_detail(db, user_id)


async def ban_user(db: AsyncSession, user_id: str) -> dict | None:
    """封禁用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    user.is_active = False
    await db.flush()
    return await get_user_detail(db, user_id)


async def unban_user(db: AsyncSession, user_id: str) -> dict | None:
    """解封用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    user.is_active = True
    await db.flush()
    return await get_user_detail(db, user_id)


async def list_books(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
) -> tuple[list[dict], int]:
    """账本分页列表"""
    # 子查询：成员数
    member_count_sub = (
        select(BookMember.book_id, func.count(BookMember.user_id).label("member_count"))
        .group_by(BookMember.book_id)
        .subquery()
    )
    # 子查询：分录数
    entry_count_sub = (
        select(JournalEntry.book_id, func.count(JournalEntry.id).label("entry_count"))
        .group_by(JournalEntry.book_id)
        .subquery()
    )

    query = (
        select(
            Book,
            User.email.label("owner_email"),
            User.nickname.label("owner_nickname"),
            func.coalesce(member_count_sub.c.member_count, 0).label("member_count"),
            func.coalesce(entry_count_sub.c.entry_count, 0).label("entry_count"),
        )
        .join(User, Book.owner_id == User.id)
        .outerjoin(member_count_sub, Book.id == member_count_sub.c.book_id)
        .outerjoin(entry_count_sub, Book.id == entry_count_sub.c.book_id)
    )

    count_query = select(func.count(Book.id))

    if search:
        like = f"%{search}%"
        search_filter = Book.name.ilike(like) | User.email.ilike(like) | User.nickname.ilike(like)
        query = query.where(search_filter)
        # count_query 也需要 JOIN User
        count_query = (
            select(func.count(Book.id))
            .join(User, Book.owner_id == User.id)
            .where(search_filter)
        )

    total = (await db.execute(count_query)).scalar()

    query = query.order_by(Book.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)

    items = []
    for book, owner_email, owner_nickname, member_count, entry_count in result.all():
        items.append({
            "id": book.id,
            "name": book.name,
            "type": book.type,
            "owner_email": owner_email,
            "owner_nickname": owner_nickname,
            "member_count": member_count,
            "entry_count": entry_count,
            "created_at": book.created_at,
        })

    return items, total
```

---

## 8. 后端 Router

### 8.1 新建 routers/admin.py

```python
# server/app/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.admin import (
    AdminLoginRequest, AdminLoginResponse,
    AdminStatsResponse, AdminUserItem, AdminUserDetail,
    AdminUserUpdate, AdminBookItem, PaginatedResponse,
)
from app.services import admin_service
from app.utils.deps import require_admin_token
from app.utils.security import create_admin_token, ADMIN_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/admin", tags=["管理后台"])


@router.post("/login", response_model=AdminLoginResponse, summary="管理密码验证")
async def admin_login(body: AdminLoginRequest):
    if not settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=404)
    if body.password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="管理密码错误")
    token = create_admin_token()
    return AdminLoginResponse(
        admin_token=token,
        expires_in=ADMIN_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/stats", response_model=AdminStatsResponse, summary="系统概览统计")
async def get_stats(
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_stats(db)


@router.get("/users", response_model=PaginatedResponse[AdminUserItem], summary="用户列表")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    status: str | None = Query(None, pattern=r"^(active|banned)$"),
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_users(db, page, page_size, search, status)
    return PaginatedResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/users/{user_id}", response_model=AdminUserDetail, summary="用户详情")
async def get_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    detail = await admin_service.get_user_detail(db, user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="用户不存在")
    return detail


@router.patch("/users/{user_id}", response_model=AdminUserDetail, summary="修改用户")
async def update_user(
    user_id: str,
    body: AdminUserUpdate,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.update_user(db, user_id, body.nickname)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.post("/users/{user_id}/ban", response_model=AdminUserDetail, summary="封禁用户")
async def ban_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.ban_user(db, user_id)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.post("/users/{user_id}/unban", response_model=AdminUserDetail, summary="解封用户")
async def unban_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.unban_user(db, user_id)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.get("/books", response_model=PaginatedResponse[AdminBookItem], summary="账本列表")
async def list_books(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_books(db, page, page_size, search)
    return PaginatedResponse(items=items, total=total, page=page, page_size=page_size)
```

### 8.2 main.py 注册

```python
# server/app/main.py
from app.routers import auth, books, accounts, entries, reports, sync, assets, loans, budgets, api_keys, plugins, admin

# 注册路由
app.include_router(admin.router)  # 新增
```

### 8.3 auth.py 更新 last_active_at

```python
# server/app/routers/auth.py — login 端点修改
@router.post("/login", response_model=AuthResponse, summary="用户登录")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await authenticate_user(db, body.email, body.password)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    # v0.4.0: 更新最后活跃时间
    user.last_active_at = datetime.utcnow()
    await db.flush()

    token = build_token(user.id)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        token=TokenResponse(**token),
    )
```

---

## 9. 前端 Service

### 9.1 新建 services/adminService.ts

```typescript
// client/services/adminService.ts
import api from './api';

// ---- 类型 ----

export type AdminLoginResponse = {
  admin_token: string;
  expires_in: number;
};

export type AdminStats = {
  total_users: number;
  active_users: number;
  banned_users: number;
  total_books: number;
  personal_books: number;
  family_books: number;
  total_entries: number;
  today_new_users: number;
  today_new_entries: number;
  weekly_active_users: number;
};

export type AdminUserItem = {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  is_active: boolean;
  book_count: number;
  created_at: string;
  last_active_at: string | null;
};

export type AdminBookItem = {
  id: string;
  name: string;
  type: string;
  owner_email: string;
  owner_nickname: string | null;
  member_count: number;
  entry_count: number;
  created_at: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type UserListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  status?: 'active' | 'banned';
};

export type BookListParams = {
  page?: number;
  page_size?: number;
  search?: string;
};

// ---- 服务 ----

/**
 * Admin API 服务
 * 所有需鉴权的接口通过 adminApi 调用（自动附加 X-Admin-Token header）
 */

let _adminToken: string | null = null;

export function setAdminToken(token: string | null) {
  _adminToken = token;
}

export function getAdminToken(): string | null {
  return _adminToken;
}

/** 带 admin token 的请求封装 */
function adminHeaders() {
  return _adminToken ? { 'X-Admin-Token': _adminToken } : {};
}

export const adminService = {
  login: (password: string) =>
    api.post<AdminLoginResponse>('/admin/login', { password }),

  getStats: () =>
    api.get<AdminStats>('/admin/stats', { headers: adminHeaders() }),

  getUsers: (params?: UserListParams) =>
    api.get<PaginatedResponse<AdminUserItem>>('/admin/users', {
      params,
      headers: adminHeaders(),
    }),

  getUser: (id: string) =>
    api.get<AdminUserItem>(`/admin/users/${id}`, { headers: adminHeaders() }),

  updateUser: (id: string, data: { nickname?: string }) =>
    api.patch<AdminUserItem>(`/admin/users/${id}`, data, {
      headers: adminHeaders(),
    }),

  banUser: (id: string) =>
    api.post<AdminUserItem>(`/admin/users/${id}/ban`, null, {
      headers: adminHeaders(),
    }),

  unbanUser: (id: string) =>
    api.post<AdminUserItem>(`/admin/users/${id}/unban`, null, {
      headers: adminHeaders(),
    }),

  getBooks: (params?: BookListParams) =>
    api.get<PaginatedResponse<AdminBookItem>>('/admin/books', {
      params,
      headers: adminHeaders(),
    }),
};
```

---

## 10. 前端 Store

### 10.1 新建 stores/adminStore.ts

```typescript
// client/stores/adminStore.ts
import { create } from 'zustand';
import { adminService, setAdminToken } from '@/services/adminService';

type AdminState = {
  adminToken: string | null;
  isAdminAuth: boolean;
  isLoading: boolean;
  error: string | null;

  adminLogin: (password: string) => Promise<void>;
  adminLogout: () => void;
};

export const useAdminStore = create<AdminState>((set) => ({
  adminToken: null,
  isAdminAuth: false,
  isLoading: false,
  error: null,

  adminLogin: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await adminService.login(password);
      setAdminToken(data.admin_token);
      set({ adminToken: data.admin_token, isAdminAuth: true, isLoading: false });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '验证失败';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  adminLogout: () => {
    setAdminToken(null);
    set({ adminToken: null, isAdminAuth: false, error: null });
  },
}));
```

admin token 仅存内存，不持久化到 AsyncStorage/localStorage，关闭页面即失效。

---

## 11. 前端页面

### 11.1 _layout.tsx（根布局）修改

在 Auth Guard 中排除 admin 路由组：

```typescript
// client/app/_layout.tsx
useEffect(() => {
  if (!isInitialized) return;
  const inAuthGroup = segments[0] === '(auth)';
  const inAdminGroup = segments[0] === 'admin';  // v0.4.0 新增

  // admin 路由有自己的守卫，不参与用户 auth guard
  if (inAdminGroup) return;

  if (!isAuthenticated && !inAuthGroup) {
    router.replace('/(auth)/login');
  } else if (isAuthenticated && inAuthGroup) {
    router.replace('/(tabs)');
  }
}, [isAuthenticated, isInitialized, segments]);

// Stack 注册
<Stack.Screen name="admin" options={{ headerShown: false }} />
```

### 11.2 admin/_layout.tsx — 管理后台布局

```typescript
// client/app/admin/_layout.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';

import { useAdminStore } from '@/stores/adminStore';
import { useColorScheme } from '@/components/useColorScheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import Colors from '@/constants/Colors';

const NAV_ITEMS = [
  { key: 'index', label: '概览', icon: 'dashboard', path: '/admin' },
  { key: 'users', label: '用户', icon: 'users', path: '/admin/users' },
  { key: 'books', label: '账本', icon: 'book', path: '/admin/books' },
];

export default function AdminLayout() {
  const { isAdminAuth, adminLogin, isLoading, error } = useAdminStore();
  const [password, setPassword] = useState('');
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const pathname = usePathname();

  // 未验证：显示密码输入页
  if (!isAdminAuth) {
    return (
      <View style={[styles.loginContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.loginCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.loginTitle, { color: colors.text }]}>管理后台</Text>
          <TextInput
            style={[styles.loginInput, {
              color: colors.text,
              backgroundColor: colorScheme === 'dark' ? '#374151' : '#F3F4F6',
              borderColor: colors.border,
            }]}
            placeholder="请输入管理密码"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable
            style={[styles.loginBtn, {
              backgroundColor: password.trim() ? Colors.primary : colors.border,
            }]}
            onPress={() => password.trim() && adminLogin(password.trim())}
            disabled={!password.trim() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 16 }}>进入后台</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // 已验证：桌面端双栏 / 移动端顶部 Tab
  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.sidebar, { borderRightColor: colors.border }]}>
          <Text style={[styles.sidebarTitle, { color: colors.text }]}>管理后台</Text>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.path ||
              (item.key === 'index' && pathname === '/admin');
            return (
              <Pressable
                key={item.key}
                style={[styles.navItem, isActive && { backgroundColor: colors.primary + '15' }]}
                onPress={() => router.push(item.path as any)}
              >
                <Text style={[styles.navText, { color: isActive ? Colors.primary : colors.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.mainContent}>
          <Slot />
        </View>
      </View>
    );
  }

  // 移动端：顶部 Tab
  return (
    <View style={[styles.mobileContainer, { backgroundColor: colors.background }]}>
      <View style={[styles.topTabs, { borderBottomColor: colors.border }]}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.path ||
            (item.key === 'index' && pathname === '/admin');
          return (
            <Pressable
              key={item.key}
              style={[styles.tab, isActive && styles.activeTab]}
              onPress={() => router.push(item.path as any)}
            >
              <Text style={[styles.tabText, {
                color: isActive ? Colors.primary : colors.textSecondary,
              }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  // 登录页
  loginContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loginCard: {
    width: '85%', maxWidth: 400, borderRadius: 14, padding: 32,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 8,
  },
  loginTitle: { fontSize: 24, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  loginInput: {
    height: 48, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 16, marginBottom: 12,
  },
  errorText: { color: '#EF4444', fontSize: 13, marginBottom: 12 },
  loginBtn: {
    height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  // 桌面端
  desktopContainer: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 200, borderRightWidth: 1, paddingTop: 20, paddingHorizontal: 12 },
  sidebarTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20, paddingHorizontal: 8 },
  navItem: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginBottom: 4 },
  navText: { fontSize: 15, fontWeight: '500' },
  mainContent: { flex: 1 },
  // 移动端
  mobileContainer: { flex: 1 },
  topTabs: { flexDirection: 'row', borderBottomWidth: 1, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 15, fontWeight: '600' },
});
```

### 11.3 admin/index.tsx — 概览仪表板

展示 6 个指标卡片（两行三列 / 移动端一行两列），调用 `adminService.getStats()`。

### 11.4 admin/users.tsx — 用户列表

- 顶部搜索框 + 状态筛选 Chip（全部/正常/已封禁）
- FlatList 分页列表
- 点击行跳转 `/admin/user/[id]`

### 11.5 admin/user/[id].tsx — 用户详情/编辑

- 显示用户信息（头像、邮箱、昵称输入框、状态、注册时间、账本数）
- 保存修改按钮
- 危险操作区：封禁/解封按钮 + Modal 确认弹窗
- 遵循 DESIGN_GUIDELINES 弹窗规范（等宽居中按钮 + 红色破坏性按钮）

### 11.6 admin/books.tsx — 账本列表

- 顶部搜索框
- FlatList 分页列表（账本名、类型、拥有者、成员数、分录数、创建时间）
- 只读，不可编辑

---

## 12. 错误处理

### 12.1 后端错误码映射

| HTTP 状态码 | 场景 | 后端 `detail` | 前端展示 |
|------------|------|--------------|---------|
| 403 | 管理密码错误 | `管理密码错误` | 输入框下方显示红字 |
| 403 | 封禁用户登录 | `账户已被封禁` | 登录页显示错误 |
| 401 | admin token 过期 | `admin token 无效或已过期` | 回到密码输入页 |
| 404 | ADMIN_PASSWORD 未配置 | 无 body | 显示「管理后台未启用」 |
| 404 | 用户不存在 | `用户不存在` | 原样展示 |

### 12.2 前端校验

| 校验项 | 实现 |
|--------|------|
| 管理密码为空 | 按钮 `disabled={!password.trim()}` |
| admin token 过期 | 响应 401 时自动 `adminLogout()` 回到密码页 |
| 昵称为空 | 按钮 `disabled={!nickname?.trim()}` |

---

## 13. 测试计划

### 13.1 后端单元测试

#### test_admin.py

| 编号 | 测试用例 | 预期 |
|------|---------|------|
| AD-1 | `POST /admin/login` 正确密码 | 200，返回 admin_token |
| AD-2 | `POST /admin/login` 错误密码 | 403 |
| AD-3 | `POST /admin/login` 未配置 ADMIN_PASSWORD | 404 |
| AD-4 | `GET /admin/stats` 无 token | 422（缺少 header） |
| AD-5 | `GET /admin/stats` 无效 token | 401 |
| AD-6 | `GET /admin/stats` 正常 | 200，返回统计数据 |
| AD-7 | `GET /admin/users` 分页 | 200，items + total |
| AD-8 | `GET /admin/users?search=xxx` 搜索 | 200，过滤结果 |
| AD-9 | `GET /admin/users?status=active` 状态筛选 | 200，仅活跃用户 |
| AD-10 | `GET /admin/users/{id}` 存在 | 200，用户详情 |
| AD-11 | `GET /admin/users/{id}` 不存在 | 404 |
| AD-12 | `PATCH /admin/users/{id}` 修改昵称 | 200，昵称更新 |
| AD-13 | `POST /admin/users/{id}/ban` 封禁 | 200，is_active=false |
| AD-14 | `POST /admin/users/{id}/unban` 解封 | 200，is_active=true |
| AD-15 | 封禁用户登录 | 403，`账户已被封禁` |
| AD-16 | 封禁用户 token 调用 API | 403 |
| AD-17 | `GET /admin/books` 分页 | 200，items + total |
| AD-18 | `GET /admin/books?search=xxx` 搜索 | 200，过滤结果 |

### 13.2 现有测试适配

需确认 `conftest.py` 中注册的用户在新增 `is_active` 字段后仍正常工作（默认 True，无需改动）。

### 13.3 手动测试场景

| 编号 | 场景 | 步骤 | 预期结果 |
|------|------|------|---------|
| T-1 | 访问 /admin | 浏览器输入 /admin | 显示密码输入页 |
| T-2 | 密码验证 | 输入正确密码 → 进入后台 | 跳转概览仪表板 |
| T-3 | 密码错误 | 输入错误密码 | 显示「管理密码错误」 |
| T-4 | 概览数据 | 进入概览页 | 6 个指标卡片展示正确 |
| T-5 | 用户列表 | 点击用户 Tab | 显示分页列表 |
| T-6 | 搜索用户 | 输入邮箱关键字 | 过滤结果 |
| T-7 | 用户详情 | 点击某用户 | 跳转详情页 |
| T-8 | 修改昵称 | 编辑昵称 → 保存 | 昵称更新 |
| T-9 | 封禁用户 | 点击封禁 → 确认 | 状态变为已封禁 |
| T-10 | 封禁生效 | 被封禁用户尝试登录 | 登录失败 |
| T-11 | 解封用户 | 点击解封 → 确认 | 状态恢复正常 |
| T-12 | 账本列表 | 点击账本 Tab | 显示只读列表 |
| T-13 | Token 过期 | 等待 2h 后操作 | 回到密码输入页 |
| T-14 | 桌面端一致性 | 桌面端执行 T-1 ~ T-12 | 行为一致 |

---

## 14. 开发实施计划

### 阶段 1：后端基础（config + model + 迁移 + security + deps）

1. `config.py` 新增 `ADMIN_PASSWORD`
2. `models/user.py` 新增 `is_active`、`last_active_at` 字段
3. `database.py` 新增 `_migrate_users_admin` 迁移函数
4. `utils/security.py` 新增 `create_admin_token`、`decode_admin_token`
5. `utils/deps.py` 新增 `require_admin_token`，修改 `get_current_user` 增加 `is_active` 校验
6. 运行现有测试确认不破坏

### 阶段 2：后端业务（schema + service + router）

1. 新建 `schemas/admin.py`
2. 新建 `services/admin_service.py`
3. 新建 `routers/admin.py`（8 个端点）
4. `main.py` 注册 admin 路由
5. `routers/auth.py` login 更新 `last_active_at`
6. Swagger 测试全部新端点

### 阶段 3：后端测试

1. 新建 `tests/test_admin.py`（18 个用例）
2. `conftest.py` 设置测试用 `ADMIN_PASSWORD`
3. 运行全量测试确认通过

### 阶段 4：前端基础（service + store + 根布局）

1. 新建 `services/adminService.ts`
2. 新建 `stores/adminStore.ts`
3. 修改 `app/_layout.tsx`（注册 admin 路由 + auth guard 排除）

### 阶段 5：前端管理后台页面

1. 新建 `app/admin/_layout.tsx`（密码验证 + 布局 + 导航）
2. 新建 `app/admin/index.tsx`（概览仪表板）
3. 新建 `app/admin/users.tsx`（用户列表）
4. 新建 `app/admin/user/[id].tsx`（用户详情/编辑）
5. 新建 `app/admin/books.tsx`（账本列表）

### 阶段 6：联调测试

1. 后端全量测试
2. 前后端联调（密码验证 → 概览 → 用户管理 → 封禁生效 → 账本列表）
3. 桌面端/移动端一致性验证
4. 手动测试全场景（T-1 ~ T-14）

---

## 15. DESIGN_GUIDELINES 遵循

| 规范 | 本版本应用 |
|------|-----------|
| 第 1 节 — 提示反馈 | 操作成功/失败统一 `showToast`（封禁/解封/保存） |
| 第 2 节 — 确认弹窗 | 封禁/解封使用 `<Modal>` 确认，按钮等宽居中（`flex: 1`），破坏性按钮红色（`#EF4444`） |
| 禁止 window.confirm/alert | 全部使用 `<Modal>` 组件 |

---

## 16. 安全约束

| 约束 | 实现 |
|------|------|
| 管理后台不能查看/修改密码 | Schema 中不包含 password 字段 |
| 管理后台不能访问账本数据 | 只返回元信息（名称/类型/数量），无分录/科目详情接口 |
| 封禁即时生效 | `get_current_user` 校验 `is_active`，封禁用户下次请求即 403 |
| admin token 短期有效 | 2h 过期，仅存内存不持久化 |
| 隐藏管理后台 | `ADMIN_PASSWORD` 为空时所有 admin 接口返回 404 |
| 无显式入口 | 前端无管理后台链接，需手动输入 `/admin` |
