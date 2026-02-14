from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., max_length=100, description="Key 名称")
    expires_at: datetime | None = Field(None, description="过期时间，NULL 永不过期")


class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    key: str  # 明文 Key，仅在创建时返回
    key_prefix: str
    is_active: bool
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    is_active: bool
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    plugin_count: int = 0

    model_config = {"from_attributes": True}


class ApiKeyUpdateRequest(BaseModel):
    is_active: bool | None = None
    name: str | None = Field(None, max_length=100)
