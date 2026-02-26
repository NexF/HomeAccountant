import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.entry import EntryCreateRequest


# ─── 配置更新请求 ─────────────────────────

class PluginConfigUpdateRequest(BaseModel):
    config: dict[str, Any] = Field(..., description="配置键值对")


# ─── 注册请求（v0.4.1: 新增 config_schema） ─────────────────────────

class PluginCreateRequest(BaseModel):
    name: str = Field(..., max_length=100, description="插件名称")
    display_name: str | None = Field(None, max_length=100, description="前端显示的插件名称")
    type: Literal["entry", "balance", "both"] = Field(..., description="插件类型")
    description: str | None = Field(None, description="插件描述")
    config_schema: dict[str, Any] | None = Field(
        None, description="配置结构定义，包含 fields 数组"
    )


# ─── 详情响应（含完整 config_schema / config） ─────────────────────────

class PluginResponse(BaseModel):
    id: str
    name: str
    display_name: str | None = None
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
            return {
                **{
                    k: getattr(data, k)
                    for k in [
                        "id", "name", "display_name", "type", "api_key_id", "description",
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


# ─── 列表响应（不含 config_schema/config 详情） ─────────────────────────

class PluginListResponse(BaseModel):
    id: str
    name: str
    display_name: str | None = None
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
                        "id", "name", "display_name", "type", "api_key_id", "description",
                        "last_sync_at", "last_sync_status", "last_error_message",
                        "sync_count", "created_at", "updated_at",
                    ]
                },
                "has_config": has_config,
                "is_configured": is_configured,
            }
        return data


# ─── 状态更新请求 ─────────────────────────

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
