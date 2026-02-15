from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.account import (
    CreateAccountRequest,
    UpdateAccountRequest,
    AccountResponse,
    AccountCreateResponse,
    AccountTreeResponse,
)
from app.services.account_service import (
    get_accounts_by_book,
    build_account_tree,
    get_account_by_id,
    create_custom_account,
    update_account,
    deactivate_account,
    AccountError,
)
from app.services.book_service import user_has_book_access
from app.utils.api_key_auth import get_current_user_flexible
from app.utils.deps import get_current_user

router = APIRouter(tags=["科目"])


async def _check_book_access(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


@router.get(
    "/books/{book_id}/accounts",
    response_model=AccountTreeResponse,
    summary="获取科目树",
)
async def get_book_accounts(
    book_id: str,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """获取指定账本下所有科目，按 type 分组返回树形结构"""
    await _check_book_access(current_user.id, book_id, db)
    accounts = await get_accounts_by_book(db, book_id)
    return build_account_tree(accounts)


@router.post(
    "/books/{book_id}/accounts",
    response_model=AccountCreateResponse,
    status_code=201,
    summary="新增科目",
)
async def create_account(
    book_id: str,
    body: CreateAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """新增自定义科目，如果父科目有历史分录则自动迁移"""
    await _check_book_access(current_user.id, book_id, db)
    account, migration_info = await create_custom_account(
        db,
        book_id=book_id,
        name=body.name,
        acc_type=body.type,
        balance_direction=body.balance_direction,
        parent_id=body.parent_id,
        icon=body.icon,
        sort_order=body.sort_order,
    )
    resp = AccountCreateResponse.model_validate(account)
    resp.migration = migration_info
    return resp


@router.put(
    "/accounts/{account_id}",
    response_model=AccountResponse,
    summary="编辑科目",
)
async def edit_account(
    account_id: str,
    body: UpdateAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """编辑科目名称、图标、排序"""
    account = await get_account_by_id(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="科目不存在")
    await _check_book_access(current_user.id, account.book_id, db)

    updated = await update_account(
        db, account, name=body.name, icon=body.icon, sort_order=body.sort_order
    )
    return AccountResponse.model_validate(updated)


@router.delete(
    "/accounts/{account_id}",
    response_model=AccountResponse,
    summary="停用科目",
)
async def delete_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """软删除（停用）科目，有分录引用或有子科目时拒绝"""
    account = await get_account_by_id(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="科目不存在")
    await _check_book_access(current_user.id, account.book_id, db)

    try:
        deactivated = await deactivate_account(db, account)
    except AccountError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return AccountResponse.model_validate(deactivated)
