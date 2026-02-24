from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.book import (
    CreateBookRequest,
    UpdateBookRequest,
    InviteMemberRequest,
    UpdateMemberRoleRequest,
    BookResponse,
    BookMemberResponse,
)
from app.services import book_service
from app.services.book_service import create_book
from app.utils.api_key_auth import get_current_user_flexible
from app.utils.deps import get_current_user, require_book_admin, require_book_member

router = APIRouter(prefix="/books", tags=["账本"])


@router.post("", response_model=BookResponse, status_code=201, summary="创建账本")
async def create(
    body: CreateBookRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建账本并自动灌入预置科目"""
    book = await create_book(db, current_user.id, body.name, body.type)
    return BookResponse.model_validate(book)


@router.get("", response_model=list[BookResponse], summary="获取账本列表")
async def list_books(
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户拥有或参与的所有账本，含角色信息"""
    books_with_role = await book_service.get_user_books_with_role(db, current_user.id)
    return books_with_role


@router.put("/{book_id}", response_model=BookResponse, summary="更新账本")
async def update_book(
    book_id: str,
    body: UpdateBookRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新账本名称，需 admin 权限"""
    book = await book_service.update_book(db, book_id, body.name)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    return BookResponse.model_validate(book)


@router.delete("/{book_id}", status_code=204, summary="删除账本")
async def delete_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除账本及所有关联数据，仅 owner 可操作"""
    book = await book_service.get_book_by_id(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    if book.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅账本创建者可删除")
    await book_service.delete_book(db, book_id)


@router.get("/{book_id}/members", response_model=list[BookMemberResponse], summary="成员列表")
async def get_members(
    book_id: str,
    current_user: User = Depends(require_book_member),
    db: AsyncSession = Depends(get_db),
):
    """获取账本成员列表，需 member+ 权限"""
    return await book_service.get_book_members(db, book_id)


@router.post("/{book_id}/members", response_model=BookMemberResponse, status_code=201, summary="邀请成员")
async def invite_member(
    book_id: str,
    body: InviteMemberRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """通过邮箱邀请成员，需 admin 权限"""
    return await book_service.invite_member(db, book_id, body.email, body.role)


@router.put("/{book_id}/members/{user_id}", response_model=BookMemberResponse, summary="修改角色")
async def update_member_role(
    book_id: str,
    user_id: str,
    body: UpdateMemberRoleRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """修改成员角色，需 admin 权限，owner 角色不可修改"""
    return await book_service.update_member_role(db, book_id, user_id, body.role)


@router.delete("/{book_id}/members/{user_id}", status_code=204, summary="移除成员")
async def remove_member(
    book_id: str,
    user_id: str,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """移除成员，需 admin 权限，owner 不可被移除"""
    await book_service.remove_member(db, book_id, user_id)


@router.post("/{book_id}/leave", status_code=204, summary="退出账本")
async def leave_book(
    book_id: str,
    current_user: User = Depends(require_book_member),
    db: AsyncSession = Depends(get_db),
):
    """退出账本，owner 不可退出"""
    book = await book_service.get_book_by_id(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    if book.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="账本创建者不可退出，请先删除账本")
    await book_service.leave_book(db, book_id, current_user.id)
