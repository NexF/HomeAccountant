"""预算检查服务"""

from datetime import date

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.budget import Budget
from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine
from app.schemas.budget import (
    BudgetResponse,
    BudgetOverview,
    BudgetCheckResult,
    BudgetAlert,
)


def _current_month_range() -> tuple[date, date]:
    """返回当月的第一天和最后一天"""
    today = date.today()
    first = today.replace(day=1)
    if today.month == 12:
        last = date(today.year + 1, 1, 1)
    else:
        last = date(today.year, today.month + 1, 1)
    return first, last


async def get_month_expense(
    db: AsyncSession,
    book_id: str,
    account_id: str | None,
    start: date,
    end: date,
) -> float:
    """
    获取某月某科目（或全部费用）的实际支出。
    查询 journal_lines 中关联费用科目的借方合计。
    """
    stmt = (
        select(func.coalesce(func.sum(JournalLine.debit_amount), 0))
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .join(Account, JournalLine.account_id == Account.id)
        .where(
            JournalEntry.book_id == book_id,
            JournalEntry.entry_date >= start,
            JournalEntry.entry_date < end,
            Account.type == "expense",
        )
    )
    if account_id:
        stmt = stmt.where(JournalLine.account_id == account_id)

    result = await db.execute(stmt)
    return float(result.scalar() or 0)


def _calc_status(usage_rate: float, threshold: float) -> str:
    if usage_rate >= 1.0:
        return "exceeded"
    if usage_rate >= threshold:
        return "warning"
    return "normal"


async def get_budget_with_usage(
    db: AsyncSession,
    budget: Budget,
) -> BudgetResponse:
    """获取预算当前状态（使用额、使用率、剩余、状态标识）"""
    first, end = _current_month_range()
    used = await get_month_expense(db, budget.book_id, budget.account_id, first, end)
    amount = float(budget.amount)
    threshold = float(budget.alert_threshold)
    usage_rate = used / amount if amount > 0 else 0
    remaining = amount - used
    status = _calc_status(usage_rate, threshold)

    account_name = None
    if budget.account:
        account_name = budget.account.name
    elif budget.account_id:
        result = await db.execute(
            select(Account.name).where(Account.id == budget.account_id)
        )
        account_name = result.scalar()

    return BudgetResponse(
        id=budget.id,
        book_id=budget.book_id,
        account_id=budget.account_id,
        account_name=account_name,
        amount=amount,
        period=budget.period,
        alert_threshold=threshold,
        is_active=budget.is_active,
        used_amount=round(used, 2),
        usage_rate=round(usage_rate, 4),
        remaining=round(remaining, 2),
        status=status,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )


async def get_overview(
    db: AsyncSession,
    book_id: str,
) -> BudgetOverview:
    """获取预算总览（总预算 + 各分类预算使用情况）"""
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(Budget.book_id == book_id, Budget.is_active == True)
        .order_by(Budget.created_at)
    )
    budgets = list(result.scalars().all())

    total_budget_obj = None
    category_budgets: list[BudgetResponse] = []

    for b in budgets:
        resp = await get_budget_with_usage(db, b)
        if b.account_id is None:
            total_budget_obj = resp
        else:
            category_budgets.append(resp)

    first, end = _current_month_range()
    total_used = await get_month_expense(db, book_id, None, first, end)

    total_budget_amount = total_budget_obj.amount if total_budget_obj else None
    total_usage_rate = None
    total_status = "not_set"

    if total_budget_amount and total_budget_amount > 0:
        total_usage_rate = round(total_used / total_budget_amount, 4)
        threshold = total_budget_obj.alert_threshold if total_budget_obj else 0.8
        total_status = _calc_status(total_usage_rate, threshold)

    return BudgetOverview(
        total_budget=total_budget_amount,
        total_used=round(total_used, 2),
        total_usage_rate=total_usage_rate,
        total_status=total_status,
        category_budgets=category_budgets,
    )


async def check_budget_after_expense(
    db: AsyncSession,
    book_id: str,
    account_id: str,
) -> BudgetCheckResult:
    """
    记账后预算检查。
    查找该科目相关的预算（分类预算 + 总预算），
    如果使用率 >= 阈值或超 100%，触发提醒。
    """
    first, end = _current_month_range()
    alerts: list[BudgetAlert] = []

    # 查找分类预算
    result = await db.execute(
        select(Budget)
        .options(selectinload(Budget.account))
        .where(
            Budget.book_id == book_id,
            Budget.account_id == account_id,
            Budget.is_active == True,
        )
    )
    category_budget = result.scalar_one_or_none()

    if category_budget:
        used = await get_month_expense(db, book_id, account_id, first, end)
        amount = float(category_budget.amount)
        threshold = float(category_budget.alert_threshold)
        usage_rate = used / amount if amount > 0 else 0
        status = _calc_status(usage_rate, threshold)

        if status in ("warning", "exceeded"):
            account_name = category_budget.account.name if category_budget.account else None
            if status == "exceeded":
                over = round(used - amount, 2)
                msg = f"{account_name or '该分类'}预算已超支 ¥{over}"
            else:
                msg = f"{account_name or '该分类'}预算已使用 {round(usage_rate * 100)}%，剩余 ¥{round(amount - used, 2)}"
            alerts.append(
                BudgetAlert(
                    budget_id=category_budget.id,
                    account_name=account_name,
                    budget_amount=amount,
                    used_amount=round(used, 2),
                    usage_rate=round(usage_rate, 4),
                    alert_type=status,
                    message=msg,
                )
            )

    # 查找总预算
    result = await db.execute(
        select(Budget)
        .where(
            Budget.book_id == book_id,
            Budget.account_id == None,
            Budget.is_active == True,
        )
    )
    total_budget = result.scalar_one_or_none()

    if total_budget:
        total_used = await get_month_expense(db, book_id, None, first, end)
        amount = float(total_budget.amount)
        threshold = float(total_budget.alert_threshold)
        usage_rate = total_used / amount if amount > 0 else 0
        status = _calc_status(usage_rate, threshold)

        if status in ("warning", "exceeded"):
            if status == "exceeded":
                over = round(total_used - amount, 2)
                msg = f"总预算已超支 ¥{over}"
            else:
                msg = f"总预算已使用 {round(usage_rate * 100)}%，剩余 ¥{round(amount - total_used, 2)}"
            alerts.append(
                BudgetAlert(
                    budget_id=total_budget.id,
                    account_name=None,
                    budget_amount=amount,
                    used_amount=round(total_used, 2),
                    usage_rate=round(usage_rate, 4),
                    alert_type=status,
                    message=msg,
                )
            )

    return BudgetCheckResult(
        triggered=len(alerts) > 0,
        alerts=alerts,
    )
