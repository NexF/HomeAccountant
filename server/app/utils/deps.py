from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.utils.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """JWT 鉴权依赖：解析 Token → 查询用户 → 返回 User 实例"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exception

    from app.services.auth_service import get_user_by_id

    user = await get_user_by_id(db, user_id)
    if user is None:
        raise credentials_exception

    return user


# ──────────── 账本权限依赖 ────────────


async def get_book_member_role(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    """获取当前用户在指定账本中的角色，非成员抛 403"""
    from app.services.book_service import get_member_role

    role = await get_member_role(db, current_user.id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")
    return role


async def require_book_admin(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """要求当前用户是指定账本的 admin"""
    from app.services.book_service import get_member_role

    role = await get_member_role(db, current_user.id, book_id)
    if role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


async def require_book_member(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """要求当前用户是指定账本的成员"""
    from app.services.book_service import get_member_role

    role = await get_member_role(db, current_user.id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")
    return current_user
