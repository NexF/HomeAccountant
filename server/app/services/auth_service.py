from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.security import hash_password, verify_password, create_access_token
from app.config import settings


class AuthError(Exception):
    """认证业务异常"""

    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    """根据邮箱查找用户"""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    """根据 ID 查找用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def register_user(db: AsyncSession, email: str, password: str, nickname: str | None = None) -> User:
    """注册新用户，返回 User 实例。邮箱重复时抛 AuthError。"""
    existing = await get_user_by_email(db, email)
    if existing:
        raise AuthError("该邮箱已被注册", status_code=409)

    user = User(
        email=email,
        password_hash=hash_password(password),
        nickname=nickname,
    )
    db.add(user)
    await db.flush()  # 获取 id 等默认值，但不 commit（由 get_db 统一提交）
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    """验证邮箱+密码，返回 User。失败抛 AuthError。"""
    user = await get_user_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise AuthError("邮箱或密码错误", status_code=401)
    return user


def build_token(user_id: str) -> dict:
    """生成 Token 及过期信息"""
    return {
        "access_token": create_access_token(user_id),
        "token_type": "bearer",
        "expires_in": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


async def update_profile(
    db: AsyncSession,
    user: User,
    nickname: str | None = None,
    avatar_url: str | None = None,
    currency: str | None = None,
) -> User:
    """更新用户个人信息"""
    if nickname is not None:
        user.nickname = nickname
    if avatar_url is not None:
        user.avatar_url = avatar_url
    if currency is not None:
        user.currency = currency
    await db.flush()
    await db.refresh(user)
    return user
