from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.sync import SnapshotCreateRequest, SnapshotResponse
from app.services.reconciliation_service import create_snapshot, ReconciliationError
from app.services.book_service import user_has_book_access
from app.utils.api_key_auth import get_current_user_flexible

router = APIRouter(tags=["对账同步"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


@router.post(
    "/accounts/{account_id}/snapshot",
    response_model=SnapshotResponse,
    status_code=201,
    summary="提交余额快照",
)
async def submit_snapshot(
    account_id: str,
    body: SnapshotCreateRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """提交外部余额，系统计算差异并自动生成调节分录"""
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
            adjust_account_id=body.adjust_account_id,
            adjust_income_account_id=body.adjust_income_account_id,
            adjust_expense_account_id=body.adjust_expense_account_id,
        )
        return SnapshotResponse(**data)
    except ReconciliationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
