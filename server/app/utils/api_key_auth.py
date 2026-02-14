from datetime import datetime

from fastapi import Request, HTTPException, Depends
from passlib.hash import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.utils.deps import get_current_user


async def get_api_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> tuple[User, ApiKey]:
    """从 API Key 解析用户，返回 (user, api_key)"""
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer hak_"):
        raise HTTPException(401, "Invalid API Key format")

    token = auth_header[7:]  # 去掉 "Bearer "

    # 1. 用前缀缩小查找范围
    prefix = token[:12]
    stmt = select(ApiKey).where(
        ApiKey.key_prefix == prefix,
        ApiKey.is_active == True,
    )
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    # 2. bcrypt 验证
    matched_key = None
    for key in candidates:
        if bcrypt.verify(token, key.key_hash):
            matched_key = key
            break

    if not matched_key:
        raise HTTPException(401, "Invalid API Key")

    # 3. 检查过期
    if matched_key.expires_at and matched_key.expires_at < datetime.utcnow():
        raise HTTPException(401, "API Key expired")

    # 4. 更新最后使用时间
    matched_key.last_used_at = datetime.utcnow()
    await db.flush()

    # 5. 加载关联用户
    user_stmt = select(User).where(User.id == matched_key.user_id)
    user = (await db.execute(user_stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    return user, matched_key


async def get_current_user_flexible(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """支持 JWT Token 或 API Key 认证"""
    auth_header = request.headers.get("Authorization", "")

    if auth_header.startswith("Bearer hak_"):
        user, _ = await get_api_user(request, db)
        return user
    else:
        return await get_current_user(
            token=auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else "",
            db=db,
        )
