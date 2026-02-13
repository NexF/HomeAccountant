from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.budget import Budget
from app.schemas.budget import (
    BudgetCreate,
    BudgetUpdate,
    BudgetResponse,
    BudgetOverview,
    BudgetCheckResult,
)
from app.services.budget_service import (
    get_budget_with_usage,
    get_overview,
    check_budget_after_expense,
)
from app.services.book_service import user_has_book_access
from app.utils.deps import get_current_user

router = APIRouter(tags=["预算"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


# ───── 预算列表 ─────

@router.get("/books/{book_id}/budgets", response_model=list[BudgetResponse])
async def list_budgets(
    book_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.book_id == book_id)
        .order_by(Budget.created_at)
    )
    budgets = list(result.scalars().all())
    return [await get_budget_with_usage(db, b) for b in budgets]


# ───── 预算详情 ─────

@router.get("/budgets/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.id == budget_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="预算不存在")
    await _check_book(user.id, budget.book_id, db)
    return await get_budget_with_usage(db, budget)


# ───── 新建预算 ─────

@router.post("/books/{book_id}/budgets", response_model=BudgetResponse, status_code=201)
async def create_budget(
    book_id: str,
    body: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)

    # 检查是否已存在同科目的预算
    stmt = select(Budget).where(
        Budget.book_id == book_id,
        Budget.account_id == body.account_id,
    )
    existing = await db.execute(stmt)
    if existing.scalar_one_or_none():
        name = "总预算" if body.account_id is None else "该科目预算"
        raise HTTPException(status_code=409, detail=f"{name}已存在")

    budget = Budget(
        book_id=book_id,
        account_id=body.account_id,
        amount=body.amount,
        alert_threshold=body.alert_threshold,
    )
    db.add(budget)
    await db.flush()
    await db.refresh(budget)

    # 重新加载关联
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.id == budget.id)
    )
    budget = result.scalar_one()
    return await get_budget_with_usage(db, budget)


# ───── 更新预算 ─────

@router.put("/budgets/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: str,
    body: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.id == budget_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="预算不存在")
    await _check_book(user.id, budget.book_id, db)

    if body.amount is not None:
        budget.amount = body.amount
    if body.alert_threshold is not None:
        budget.alert_threshold = body.alert_threshold
    if body.is_active is not None:
        budget.is_active = body.is_active

    await db.flush()
    await db.refresh(budget)
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.id == budget.id)
    )
    budget = result.scalar_one()
    return await get_budget_with_usage(db, budget)


# ───── 删除预算 ─────

@router.delete("/budgets/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="预算不存在")
    await _check_book(user.id, budget.book_id, db)
    await db.delete(budget)


# ───── 预算总览 ─────

@router.get("/books/{book_id}/budgets/overview", response_model=BudgetOverview)
async def budget_overview(
    book_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)
    return await get_overview(db, book_id)


# ───── 预算检查（记账后调用） ─────

@router.post("/books/{book_id}/budgets/check", response_model=BudgetCheckResult)
async def check_budget(
    book_id: str,
    account_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)
    return await check_budget_after_expense(db, book_id, account_id)
