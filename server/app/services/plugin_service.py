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
        if body.display_name is not None:
            existing.display_name = body.display_name
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
        display_name=body.display_name,
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
) -> Plugin:
    """更新插件配置（含校验）"""
    plugin = await get_plugin(db, plugin_id, user_id)

    if not plugin.config_schema:
        raise HTTPException(400, "该插件不支持配置")

    schema = json.loads(plugin.config_schema)
    fields = schema.get("fields", [])
    # 构建 key→field_def 索引，方便 depends_on 查找
    field_map = {f["key"]: f for f in fields}

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
        if field_type == "book_select":
            # 校验用户有权访问该账本
            from app.models.book import Book, BookMember
            is_multi = field_def.get("multi", False)

            if is_multi:
                # ── 多账本模式 ──
                if not isinstance(value, list):
                    errors.append({"key": key, "error": "多账本模式下值必须为数组"})
                    continue
                if required and len(value) == 0:
                    errors.append({"key": key, "error": "至少选择一个账本"})
                    continue
                if len(value) != len(set(value)):
                    errors.append({"key": key, "error": "账本不可重复"})
                    continue
                # 逐一校验每个 book_id
                has_error = False
                for book_id in value:
                    book_result = await db.execute(
                        select(Book).where(Book.id == book_id)
                    )
                    book = book_result.scalar_one_or_none()
                    if not book:
                        errors.append({"key": key, "error": f"账本 {book_id} 不存在"})
                        has_error = True
                        continue
                    if book.owner_id != user_id:
                        member_result = await db.execute(
                            select(BookMember).where(
                                BookMember.book_id == book_id,
                                BookMember.user_id == user_id,
                            )
                        )
                        if not member_result.scalar_one_or_none():
                            errors.append({"key": key, "error": f"无权访问账本 {book_id}"})
                            has_error = True
                if has_error:
                    continue
            else:
                # ── 单账本模式（不变） ──
                book_result = await db.execute(
                    select(Book).where(Book.id == value)
                )
                book = book_result.scalar_one_or_none()
                if not book:
                    errors.append({"key": key, "error": f"账本 {value} 不存在"})
                    continue
                if book.owner_id != user_id:
                    member_result = await db.execute(
                        select(BookMember).where(
                            BookMember.book_id == value,
                            BookMember.user_id == user_id,
                        )
                    )
                    if not member_result.scalar_one_or_none():
                        errors.append({"key": key, "error": f"无权访问账本 {value}"})
                        continue
        if field_type == "account_select":
            # 从 depends_on 指向的 book_select 字段获取 book_id
            depends_on = field_def.get("depends_on")
            if not depends_on or depends_on not in field_map:
                errors.append({"key": key, "error": "account_select 必须配置 depends_on 指向一个 book_select 字段"})
                continue
            dep_field = field_map[depends_on]
            if dep_field["type"] != "book_select":
                errors.append({"key": key, "error": f"depends_on 指向的字段 '{depends_on}' 不是 book_select 类型"})
                continue

            is_multi = dep_field.get("multi", False)
            from app.models.account import Account

            if is_multi:
                # ── 多账本模式：value 为 {book_id: account_id} 映射 ──
                if not isinstance(value, dict):
                    errors.append({"key": key, "error": "多账本模式下科目配置必须为对象"})
                    continue
                book_ids = config.get(depends_on, [])
                if not isinstance(book_ids, list):
                    book_ids = []
                # 必填时，每个已选 book 都要有对应科目
                if required:
                    missing = [bid for bid in book_ids if value.get(bid) in (None, "")]
                    if missing:
                        errors.append({"key": key, "error": f"以下账本的科目未配置: {missing}"})
                        continue
                # 逐一校验每个 account_id 归属
                has_error = False
                for bid, account_id in value.items():
                    if bid not in book_ids:
                        continue  # 忽略多余的 key
                    if account_id in (None, ""):
                        continue  # 非必填时允许空
                    result = await db.execute(
                        select(Account).where(
                            Account.id == account_id,
                            Account.book_id == bid,
                        )
                    )
                    if not result.scalar_one_or_none():
                        errors.append({"key": key, "error": f"科目 {account_id} 不存在或不属于账本 {bid}"})
                        has_error = True
                # 过滤 value：只保留 book_ids 中存在的 key
                filtered_value = {bid: value[bid] for bid in book_ids if bid in value and value[bid] not in (None, "")}
                filtered_config[key] = filtered_value
                if has_error:
                    continue
                continue  # 已在分支内赋值 filtered_config
            else:
                # ── 单账本模式（不变） ──
                ref_book_id = config.get(depends_on)
                if not ref_book_id:
                    errors.append({"key": key, "error": f"请先选择「{dep_field.get('label', depends_on)}」"})
                    continue
                result = await db.execute(
                    select(Account).where(
                        Account.id == value,
                        Account.book_id == ref_book_id,
                    )
                )
                if not result.scalar_one_or_none():
                    errors.append({"key": key, "error": f"科目 {value} 不存在或不属于所选账本"})
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
