from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

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
