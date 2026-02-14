from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.entry import EntryCreateRequest


class PluginCreateRequest(BaseModel):
    name: str = Field(..., max_length=100, description="插件名称")
    type: Literal["entry", "balance", "both"] = Field(..., description="插件类型")
    description: str | None = Field(None, description="插件描述")


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

    model_config = {"from_attributes": True}


class PluginStatusUpdateRequest(BaseModel):
    status: Literal["running", "success", "failed"] = Field(..., description="同步状态")
    error_message: str | None = Field(None, description="错误信息（仅 failed 时需要）")


# ─── 批量记账 Schema ─────────────────────────


class BatchEntryItem(EntryCreateRequest):
    """单条批量记账记录，继承 EntryCreateRequest"""
    pass


class BatchEntryRequest(BaseModel):
    book_id: str = Field(..., description="目标账本 ID")
    entries: list[BatchEntryItem] = Field(..., max_length=200, description="批量记账条目，最多 200 条")


class BatchEntryResultItem(BaseModel):
    index: int
    external_id: str | None = None
    status: Literal["created", "skipped"]
    entry_id: str | None = None


class BatchEntryResponse(BaseModel):
    total: int
    created: int
    skipped: int
    results: list[BatchEntryResultItem]
