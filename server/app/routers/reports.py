from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.report import (
    BalanceSheetResponse,
    IncomeStatementResponse,
    DashboardResponse,
    NetWorthTrendPoint,
    BreakdownItem,
)
from app.services.book_service import user_has_book_access
from app.services.report_service import (
    get_balance_sheet,
    get_income_statement,
    get_dashboard,
    get_net_worth_trend,
    get_expense_breakdown,
    get_asset_allocation,
)
from app.utils.deps import get_current_user

router = APIRouter(tags=["报表"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


@router.get(
    "/books/{book_id}/balance-sheet",
    response_model=BalanceSheetResponse,
    summary="资产负债表",
)
async def balance_sheet(
    book_id: str,
    as_of_date: date = Query(default=None, alias="date", description="截止日期，默认今天"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取截至指定日期的资产负债表"""
    await _check_book(current_user.id, book_id, db)
    target_date = as_of_date or date.today()
    result = await get_balance_sheet(db, book_id, target_date)
    return BalanceSheetResponse(**result)


@router.get(
    "/books/{book_id}/income-statement",
    response_model=IncomeStatementResponse,
    summary="损益表",
)
async def income_statement(
    book_id: str,
    start: date = Query(..., description="开始日期"),
    end: date = Query(..., description="结束日期"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取指定时间段的损益表"""
    await _check_book(current_user.id, book_id, db)
    if start > end:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")
    result = await get_income_statement(db, book_id, start, end)
    return IncomeStatementResponse(**result)


@router.get(
    "/books/{book_id}/dashboard",
    response_model=DashboardResponse,
    summary="仪表盘",
)
async def dashboard(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回净资产、本月收入/费用/损益、较上月变化、近5条分录"""
    await _check_book(current_user.id, book_id, db)
    result = await get_dashboard(db, book_id)
    return DashboardResponse(**result)


@router.get(
    "/books/{book_id}/net-worth-trend",
    response_model=list[NetWorthTrendPoint],
    summary="净资产趋势",
)
async def net_worth_trend(
    book_id: str,
    months: int = Query(default=12, ge=1, le=60, description="月数"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """近 N 个月净资产趋势数据"""
    await _check_book(current_user.id, book_id, db)
    result = await get_net_worth_trend(db, book_id, months)
    return [NetWorthTrendPoint(**p) for p in result]


@router.get(
    "/books/{book_id}/expense-breakdown",
    response_model=list[BreakdownItem],
    summary="费用分类占比",
)
async def expense_breakdown(
    book_id: str,
    start: date = Query(..., description="开始日期"),
    end: date = Query(..., description="结束日期"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """费用分类占比"""
    await _check_book(current_user.id, book_id, db)
    if start > end:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")
    result = await get_expense_breakdown(db, book_id, start, end)
    return [BreakdownItem(**item) for item in result]


@router.get(
    "/books/{book_id}/asset-allocation",
    response_model=list[BreakdownItem],
    summary="资产配置占比",
)
async def asset_allocation(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """资产配置占比"""
    await _check_book(current_user.id, book_id, db)
    result = await get_asset_allocation(db, book_id)
    return [BreakdownItem(**item) for item in result]
