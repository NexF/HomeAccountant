from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.plugin import (
    BatchEntryRequest,
    BatchEntryResponse,
    PluginConfigUpdateRequest,
    PluginCreateRequest,
    PluginListResponse,
    PluginResponse,
    PluginStatusUpdateRequest,
)
from app.services import plugin_service
from app.services import batch_entry_service
from app.utils.api_key_auth import get_api_user, get_current_user_flexible
from app.utils.deps import get_current_user

router = APIRouter(prefix="/plugins", tags=["Plugins"])


@router.post("", response_model=PluginResponse)
async def register_plugin(
    body: PluginCreateRequest,
    response: Response,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    """注册插件（幂等：同名插件返回已有记录）。需要 API Key 认证。"""
    user, api_key = auth
    plugin, is_new = await plugin_service.create_plugin(db, user.id, api_key.id, body)
    response.status_code = 201 if is_new else 200
    return plugin


@router.get("", response_model=list[PluginListResponse])
async def list_plugins(
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的所有插件。支持 JWT 或 API Key 认证。
    返回 PluginListResponse（含 has_config / is_configured，不含 config_schema / config 详情）。
    """
    return await plugin_service.list_plugins(db, user.id)


@router.get("/{plugin_id}", response_model=PluginResponse)
async def get_plugin(
    plugin_id: str,
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """获取单个插件详情（含完整 config_schema / config）。支持 JWT 或 API Key 认证。"""
    return await plugin_service.get_plugin(db, plugin_id, user.id)


@router.put("/{plugin_id}/config", response_model=PluginResponse)
async def update_config(
    plugin_id: str,
    body: PluginConfigUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新插件配置。仅支持 JWT 认证。
    配置值会根据 config_schema 进行校验（必填、类型、select 范围、book_select 权限、account_select 存在性）。
    account_select 字段通过 depends_on 引用 book_select 字段获取目标账本 ID。
    """
    return await plugin_service.update_plugin_config(
        db, plugin_id, user.id, body.config
    )


@router.put("/{plugin_id}/status", response_model=PluginResponse)
async def update_status(
    plugin_id: str,
    body: PluginStatusUpdateRequest,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    """更新插件同步状态。需要 API Key 认证。"""
    user, _ = auth
    return await plugin_service.update_plugin_status(db, plugin_id, user.id, body)


@router.delete("/{plugin_id}", status_code=204)
async def delete_plugin(
    plugin_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除插件。仅支持 JWT 认证。"""
    await plugin_service.delete_plugin(db, plugin_id, user.id)


# ─── 批量记账 API ─────────────────────────


@router.post("/{plugin_id}/entries/batch", response_model=BatchEntryResponse)
async def batch_entries(
    plugin_id: str,
    body: BatchEntryRequest,
    auth: tuple[User, ApiKey] = Depends(get_api_user),
    db: AsyncSession = Depends(get_db),
):
    """批量创建分录。需要 API Key 认证。事务性保证：任何一条失败则整体回滚。"""
    user, _ = auth

    # 校验 plugin 归属
    plugin = await plugin_service.get_plugin(db, plugin_id, user.id)

    # 批量创建
    result = await batch_entry_service.batch_create_entries(
        db, user, body.book_id, body.entries
    )

    # 更新插件状态
    plugin.last_sync_at = datetime.utcnow()
    plugin.last_sync_status = "success"
    plugin.sync_count += 1
    plugin.last_error_message = None
    plugin.updated_at = datetime.utcnow()

    return result
