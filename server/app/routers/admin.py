from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.admin import (
    AdminLoginRequest, AdminLoginResponse,
    AdminStatsResponse, AdminUserItem, AdminUserDetail,
    AdminUserUpdate, AdminBookItem, PaginatedResponse,
)
from app.services import admin_service
from app.utils.deps import require_admin_token
from app.utils.security import create_admin_token, ADMIN_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/admin", tags=["管理后台"])


@router.post("/login", response_model=AdminLoginResponse, summary="管理密码验证")
async def admin_login(body: AdminLoginRequest):
    if not settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=404)
    if body.password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="管理密码错误")
    token = create_admin_token()
    return AdminLoginResponse(
        admin_token=token,
        expires_in=ADMIN_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/stats", response_model=AdminStatsResponse, summary="系统概览统计")
async def get_stats(
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_stats(db)


@router.get("/users", response_model=PaginatedResponse[AdminUserItem], summary="用户列表")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    status: str | None = Query(None, pattern=r"^(active|banned)$"),
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_users(db, page, page_size, search, status)
    return PaginatedResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/users/{user_id}", response_model=AdminUserDetail, summary="用户详情")
async def get_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    detail = await admin_service.get_user_detail(db, user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="用户不存在")
    return detail


@router.patch("/users/{user_id}", response_model=AdminUserDetail, summary="修改用户")
async def update_user(
    user_id: str,
    body: AdminUserUpdate,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.update_user(db, user_id, body.nickname)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.post("/users/{user_id}/ban", response_model=AdminUserDetail, summary="封禁用户")
async def ban_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.ban_user(db, user_id)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.post("/users/{user_id}/unban", response_model=AdminUserDetail, summary="解封用户")
async def unban_user(
    user_id: str,
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await admin_service.unban_user(db, user_id)
    if not result:
        raise HTTPException(status_code=404, detail="用户不存在")
    return result


@router.get("/books", response_model=PaginatedResponse[AdminBookItem], summary="账本列表")
async def list_books(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    _=Depends(require_admin_token),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_books(db, page, page_size, search)
    return PaginatedResponse(items=items, total=total, page=page, page_size=page_size)
