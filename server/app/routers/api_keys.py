from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.api_key import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyResponse,
    ApiKeyUpdateRequest,
)
from app.services import api_key_service
from app.utils.deps import get_current_user

router = APIRouter(prefix="/api-keys", tags=["API Keys"])


@router.post("", response_model=ApiKeyCreateResponse, status_code=201)
async def create_key(
    body: ApiKeyCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建 API Key（明文仅此一次返回）"""
    api_key, plain_key = await api_key_service.create_api_key(
        db, user.id, body.name, body.expires_at
    )
    return ApiKeyCreateResponse(
        id=api_key.id,
        name=api_key.name,
        key=plain_key,
        key_prefix=api_key.key_prefix,
        is_active=api_key.is_active,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
    )


@router.get("", response_model=list[ApiKeyResponse])
async def list_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的所有 API Key"""
    return await api_key_service.list_api_keys(db, user.id)


@router.patch("/{key_id}", response_model=ApiKeyResponse)
async def update_key(
    key_id: str,
    body: ApiKeyUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新 API Key（启用/停用、改名）"""
    key = await api_key_service.update_api_key(db, key_id, user.id, body)
    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        expires_at=key.expires_at,
        created_at=key.created_at,
    )


@router.delete("/{key_id}", status_code=204)
async def delete_key(
    key_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除 API Key（级联删除关联插件）"""
    await api_key_service.delete_api_key(db, key_id, user.id)
