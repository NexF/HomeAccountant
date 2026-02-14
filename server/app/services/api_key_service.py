import secrets
from datetime import datetime

from fastapi import HTTPException
from passlib.hash import bcrypt
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.api_key import ApiKey
from app.schemas.api_key import ApiKeyUpdateRequest


def generate_api_key() -> tuple[str, str, str]:
    """生成 API Key，返回 (明文key, 前缀, 哈希)"""
    raw = secrets.token_urlsafe(32)
    full_key = f"hak_{raw}"
    prefix = full_key[:12]
    key_hash = bcrypt.hash(full_key)
    return full_key, prefix, key_hash


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


async def list_api_keys(db: AsyncSession, user_id: str) -> list[dict]:
    """列出用户的所有 API Key，附带关联插件数量"""
    from app.models.plugin import Plugin

    stmt = (
        select(
            ApiKey,
            func.count(Plugin.id).label("plugin_count"),
        )
        .outerjoin(Plugin, Plugin.api_key_id == ApiKey.id)
        .where(ApiKey.user_id == user_id)
        .group_by(ApiKey.id)
        .order_by(ApiKey.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    keys = []
    for api_key, plugin_count in rows:
        keys.append({
            "id": api_key.id,
            "name": api_key.name,
            "key_prefix": api_key.key_prefix,
            "is_active": api_key.is_active,
            "last_used_at": api_key.last_used_at,
            "expires_at": api_key.expires_at,
            "created_at": api_key.created_at,
            "plugin_count": plugin_count,
        })
    return keys


async def get_api_key(db: AsyncSession, key_id: str, user_id: str) -> ApiKey:
    stmt = select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
    key = (await db.execute(stmt)).scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API Key not found")
    return key


async def delete_api_key(db: AsyncSession, key_id: str, user_id: str) -> None:
    key = await get_api_key(db, key_id, user_id)
    await db.delete(key)


async def update_api_key(
    db: AsyncSession, key_id: str, user_id: str, body: ApiKeyUpdateRequest
) -> ApiKey:
    key = await get_api_key(db, key_id, user_id)
    if body.is_active is not None:
        key.is_active = body.is_active
    if body.name is not None:
        key.name = body.name
    await db.flush()
    await db.refresh(key)
    return key
