import json
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
    """注册插件（幂等）。v0.4.1: 支持 config_schema。
    返回 (plugin, is_new)。
    同一用户下 name 相同的插件视为同一个，直接返回已有记录。
    """
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


async def delete_plugin(db: AsyncSession, plugin_id: str, user_id: str) -> None:
    """删除插件"""
    plugin = await get_plugin(db, plugin_id, user_id)
    await db.delete(plugin)
