from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    ProfileUpdateRequest,
    AuthResponse,
    UserResponse,
    TokenResponse,
)
from app.services.auth_service import (
    register_user,
    authenticate_user,
    build_token,
    update_profile,
    AuthError,
)
from app.services.book_service import create_book
from app.utils.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/register", response_model=AuthResponse, status_code=201, summary="用户注册")
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """邮箱 + 密码注册，返回用户信息和 JWT Token"""
    try:
        user = await register_user(db, body.email, body.password, body.nickname)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    # 注册成功后自动创建默认个人账本（含预置科目）
    await create_book(db, user.id, "个人账本", "personal")

    token = build_token(user.id)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        token=TokenResponse(**token),
    )


@router.post("/login", response_model=AuthResponse, summary="用户登录")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """邮箱 + 密码登录，返回用户信息和 JWT Token"""
    try:
        user = await authenticate_user(db, body.email, body.password)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    token = build_token(user.id)
    return AuthResponse(
        user=UserResponse.model_validate(user),
        token=TokenResponse(**token),
    )


@router.get("/me", response_model=UserResponse, summary="获取当前用户")
async def get_me(current_user: User = Depends(get_current_user)):
    """根据 Token 返回当前登录用户信息"""
    return UserResponse.model_validate(current_user)


@router.put("/profile", response_model=UserResponse, summary="更新个人信息")
async def update_profile_endpoint(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的昵称、头像、货币等"""
    user = await update_profile(
        db,
        current_user,
        nickname=body.nickname,
        avatar_url=body.avatar_url,
        currency=body.currency,
    )
    return UserResponse.model_validate(user)
