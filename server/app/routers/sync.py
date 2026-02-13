from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.sync import (
    SnapshotCreateRequest,
    SnapshotResponse,
    PendingReconcileItem,
    ConfirmRequest,
    ConfirmResponse,
    SplitRequest,
    SplitResponse,
    PendingCountResponse,
)
from app.services.reconciliation_service import (
    create_snapshot,
    get_pending_reconciliations,
    get_pending_count,
    confirm_reconciliation,
    split_reconciliation,
    ReconciliationError,
)
from app.services.book_service import user_has_book_access
from app.services.entry_service import get_entry_detail
from app.utils.deps import get_current_user

router = APIRouter(tags=["对账同步"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


async def _check_entry_book(user_id: str, entry_id: str, db: AsyncSession) -> str:
    """获取分录所属 book_id 并校验权限"""
    entry = await get_entry_detail(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="分录不存在")
    if not await user_has_book_access(db, user_id, entry.book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")
    return entry.book_id


@router.post(
    "/accounts/{account_id}/snapshot",
    response_model=SnapshotResponse,
    status_code=201,
    summary="提交余额快照",
)
async def submit_snapshot(
    account_id: str,
    body: SnapshotCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """用户手动输入外部余额，系统计算差异并可能生成调节分录"""
    # 先获取科目找 book_id
    from app.models.account import Account
    from sqlalchemy import select
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="科目不存在")

    await _check_book(current_user.id, account.book_id, db)

    try:
        data = await create_snapshot(
            db,
            book_id=account.book_id,
            user_id=current_user.id,
            account_id=account_id,
            external_balance=Decimal(str(body.external_balance)),
            snapshot_date=body.snapshot_date,
        )
        return SnapshotResponse(**data)
    except ReconciliationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.get(
    "/books/{book_id}/pending-reconciliations",
    response_model=list[PendingReconcileItem],
    summary="获取待处理队列",
)
async def pending_reconciliations(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取待处理的调节分录列表"""
    await _check_book(current_user.id, book_id, db)
    items = await get_pending_reconciliations(db, book_id)
    return [PendingReconcileItem(**item) for item in items]


@router.get(
    "/books/{book_id}/pending-count",
    response_model=PendingCountResponse,
    summary="待处理数量",
)
async def pending_count(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取待处理调节数量（用于角标）"""
    await _check_book(current_user.id, book_id, db)
    count = await get_pending_count(db, book_id)
    return PendingCountResponse(count=count)


@router.put(
    "/entries/{entry_id}/confirm",
    response_model=ConfirmResponse,
    summary="确认调节分录分类",
)
async def confirm_entry(
    entry_id: str,
    body: ConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """用户确认调节分录的目标分类科目"""
    book_id = await _check_entry_book(current_user.id, entry_id, db)
    try:
        data = await confirm_reconciliation(
            db, entry_id, body.target_account_id, book_id
        )
        return ConfirmResponse(**data)
    except ReconciliationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.post(
    "/entries/{entry_id}/split",
    response_model=SplitResponse,
    summary="拆分调节分录",
)
async def split_entry(
    entry_id: str,
    body: SplitRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """将调节分录拆分为多个目标科目"""
    book_id = await _check_entry_book(current_user.id, entry_id, db)
    try:
        data = await split_reconciliation(
            db, entry_id, book_id, current_user.id,
            [s.model_dump() for s in body.splits],
        )
        return SplitResponse(**data)
    except ReconciliationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
