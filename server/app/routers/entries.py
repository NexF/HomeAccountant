from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.entry import (
    EntryCreateRequest,
    EntryUpdateRequest,
    EntryDetailResponse,
    EntryListResponse,
    EntryResponse,
    JournalLineResponse,
)
from app.services.entry_service import (
    create_expense,
    create_income,
    create_asset_purchase,
    create_borrow,
    create_repayment,
    create_transfer,
    create_manual_entry,
    get_entry_detail,
    get_entries_paginated,
    update_entry,
    delete_entry,
    EntryError,
)
from app.services.book_service import user_has_book_access
from app.utils.deps import get_current_user

router = APIRouter(tags=["分录"])


def _calc_net_worth_impact(entry) -> float:
    """
    计算一条分录对净资产的影响。
    净资产 = 资产 - 负债，所以：
    净资产变动 = 资产变动 - 负债变动
    只看资产和负债科目即可，收入/费用的对手方一定在资产或负债中，
    不需要重复计算，否则会导致复杂分录（如处置资产）金额翻倍。
    """
    asset_delta = 0.0
    liability_delta = 0.0
    for line in entry.lines:
        acct = line.account
        if not acct:
            continue
        d = float(line.debit_amount or 0)
        c = float(line.credit_amount or 0)
        if acct.type == "asset":
            asset_delta += d - c
        elif acct.type == "liability":
            liability_delta += c - d
    return round(asset_delta - liability_delta, 2)


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


def _to_detail(entry, asset_id: str | None = None) -> EntryDetailResponse:
    """将 ORM JournalEntry 转为响应模型（含 lines + 科目名称）"""
    lines = []
    for l in entry.lines:
        lines.append(
            JournalLineResponse(
                id=l.id,
                entry_id=l.entry_id,
                account_id=l.account_id,
                debit_amount=l.debit_amount,
                credit_amount=l.credit_amount,
                description=l.description,
                account_name=l.account.name if l.account else None,
                account_code=l.account.code if l.account else None,
            )
        )
    return EntryDetailResponse(
        id=entry.id,
        book_id=entry.book_id,
        user_id=entry.user_id,
        entry_date=entry.entry_date,
        entry_type=entry.entry_type,
        description=entry.description,
        note=entry.note,
        is_balanced=entry.is_balanced,
        source=entry.source,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        lines=lines,
        asset_id=asset_id,
    )


@router.post(
    "/books/{book_id}/entries",
    response_model=EntryDetailResponse,
    status_code=201,
    summary="创建分录",
)
async def create_entry(
    book_id: str,
    body: EntryCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """根据 entry_type 自动生成复式分录"""
    await _check_book(current_user.id, book_id, db)

    asset_id = None
    try:
        if body.entry_type == "expense":
            if not body.amount or not body.category_account_id or not body.payment_account_id:
                raise EntryError("费用分录需要 amount, category_account_id, payment_account_id")
            entry = await create_expense(
                db, book_id, current_user.id, body.entry_date, body.amount,
                body.category_account_id, body.payment_account_id,
                body.description, body.note,
            )

        elif body.entry_type == "income":
            if not body.amount or not body.category_account_id or not body.payment_account_id:
                raise EntryError("收入分录需要 amount, category_account_id, payment_account_id")
            entry = await create_income(
                db, book_id, current_user.id, body.entry_date, body.amount,
                body.category_account_id, body.payment_account_id,
                body.description, body.note,
            )

        elif body.entry_type == "asset_purchase":
            if not body.amount or not body.asset_account_id or not body.payment_account_id:
                raise EntryError("购买资产需要 amount, asset_account_id, payment_account_id")
            entry, asset_id = await create_asset_purchase(
                db, book_id, current_user.id, body.entry_date, body.amount,
                body.asset_account_id, body.payment_account_id,
                body.description, body.note,
                body.extra_liability_account_id, body.extra_liability_amount,
                body.asset_name, body.useful_life_months,
                body.residual_rate, body.depreciation_method,
                body.depreciation_granularity,
                loan_name=body.loan_name,
                annual_rate=body.annual_rate,
                total_months=body.total_months,
                repayment_method=body.repayment_method,
                start_date=body.start_date,
            )

        elif body.entry_type == "borrow":
            if not body.amount or not body.payment_account_id or not body.liability_account_id:
                raise EntryError("借入需要 amount, payment_account_id, liability_account_id")
            entry = await create_borrow(
                db, book_id, current_user.id, body.entry_date, body.amount,
                body.payment_account_id, body.liability_account_id,
                body.description, body.note,
                loan_name=body.loan_name,
                annual_rate=body.annual_rate,
                total_months=body.total_months,
                repayment_method=body.repayment_method,
                start_date=body.start_date,
            )

        elif body.entry_type == "repay":
            if body.principal is None or body.interest is None:
                raise EntryError("还款需要 principal, interest")
            if not body.liability_account_id or not body.payment_account_id:
                raise EntryError("还款需要 liability_account_id, payment_account_id")
            entry = await create_repayment(
                db, book_id, current_user.id, body.entry_date,
                body.principal, body.interest,
                body.liability_account_id, body.payment_account_id,
                body.category_account_id,
                body.description, body.note,
            )

        elif body.entry_type == "transfer":
            if not body.amount or not body.from_account_id or not body.to_account_id:
                raise EntryError("转账需要 amount, from_account_id, to_account_id")
            entry = await create_transfer(
                db, book_id, current_user.id, body.entry_date, body.amount,
                body.from_account_id, body.to_account_id,
                body.description, body.note,
            )

        elif body.entry_type == "manual":
            if not body.lines or len(body.lines) < 2:
                raise EntryError("手动分录至少需要 2 行")
            entry = await create_manual_entry(
                db, book_id, current_user.id, body.entry_date,
                [l.model_dump() for l in body.lines],
                body.description, body.note,
            )

        else:
            raise EntryError(f"不支持的分录类型: {body.entry_type}")

    except EntryError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    # 重新加载含 lines + account 的完整数据
    detail = await get_entry_detail(db, entry.id)
    return _to_detail(detail, asset_id=asset_id)


@router.get(
    "/books/{book_id}/entries",
    response_model=EntryListResponse,
    summary="分录列表",
)
async def list_entries(
    book_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    entry_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    account_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """分录列表（分页，支持按日期/类型/科目筛选）"""
    await _check_book(current_user.id, book_id, db)

    entries, total = await get_entries_paginated(
        db, book_id, page, page_size, entry_type, start_date, end_date, account_id,
    )
    items = []
    for e in entries:
        resp = EntryResponse.model_validate(e)
        resp.net_worth_impact = _calc_net_worth_impact(e)
        items.append(resp)
    return EntryListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/entries/{entry_id}",
    response_model=EntryDetailResponse,
    summary="分录详情",
)
async def get_detail(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取分录详情（含借贷明细）"""
    entry = await get_entry_detail(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="分录不存在")
    await _check_book(current_user.id, entry.book_id, db)
    return _to_detail(entry)


@router.put(
    "/entries/{entry_id}",
    response_model=EntryDetailResponse,
    summary="编辑分录",
)
async def edit_entry(
    entry_id: str,
    body: EntryUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """编辑分录元数据（日期、描述、备注）"""
    entry = await get_entry_detail(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="分录不存在")
    await _check_book(current_user.id, entry.book_id, db)

    updated = await update_entry(
        db, entry,
        entry_date=body.entry_date,
        description=body.description,
        note=body.note,
    )
    detail = await get_entry_detail(db, updated.id)
    return _to_detail(detail)


@router.delete(
    "/entries/{entry_id}",
    status_code=204,
    summary="删除分录",
)
async def remove_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除分录（级联删除借贷明细）"""
    entry = await get_entry_detail(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="分录不存在")
    await _check_book(current_user.id, entry.book_id, db)

    await delete_entry(db, entry)
