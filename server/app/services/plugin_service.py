from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plugin import Plugin
from app.schemas.plugin import PluginCreateRequest, PluginStatusUpdateRequest


async def create_plugin(
    db: AsyncSession,
    user_id: str,
    api_key_id: str,
    body: PluginCreateRequest,
) -> tuple[Plugin, bool]:
    """注册插件（幂等）。返回 (plugin, is_new)。
    同一用户下 name 相同的插件视为同一个，直接返回已有记录。
    """
    stmt = select(Plugin).where(
        Plugin.user_id == user_id,
        Plugin.name == body.name,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        existing.api_key_id = api_key_id
        if body.type:
            existing.type = body.type
        if body.description is not None:
            existing.description = body.description
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
    )
    db.add(plugin)
    await db.flush()
    await db.refresh(plugin)
    return plugin, True


async def list_plugins(db: AsyncSession, user_id: str) -> list[Plugin]:
    """列出用户的所有插件"""
    stmt = (
        select(Plugin)
        .where(Plugin.user_id == user_id)
        .order_by(Plugin.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_plugin(db: AsyncSession, plugin_id: str, user_id: str) -> Plugin:
    """获取单个插件（校验归属）"""
    stmt = select(Plugin).where(Plugin.id == plugin_id, Plugin.user_id == user_id)
    plugin = (await db.execute(stmt)).scalar_one_or_none()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    return plugin


async def update_plugin_status(
    db: AsyncSession,
    plugin_id: str,
    user_id: str,
    body: PluginStatusUpdateRequest,
) -> Plugin:
    """更新插件同步状态"""
    plugin = await get_plugin(db, plugin_id, user_id)

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


async def delete_plugin(db: AsyncSession, plugin_id: str, user_id: str) -> None:
    """删除插件"""
    plugin = await get_plugin(db, plugin_id, user_id)
    await db.delete(plugin)
