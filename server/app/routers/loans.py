"""贷款管理 API 路由"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.loan import Loan
from app.schemas.loan import (
    LoanCreate, LoanUpdate, LoanResponse, LoanSummary,
    RepaymentScheduleItem, LoanRepayRequest, LoanPrepayRequest,
)
from app.services.loan_service import (
    create_loan, get_loan_with_account, generate_schedule,
    calc_total_interest, record_repayment, record_prepayment, LoanError,
)
from app.services.book_service import user_has_book_access
from app.utils.deps import get_current_user

router = APIRouter(tags=["贷款管理"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


def _to_response(loan: Loan) -> LoanResponse:
    total_interest = calc_total_interest(
        float(loan.principal), float(loan.annual_rate),
        loan.total_months, loan.repayment_method, loan.start_date,
    )
    return LoanResponse(
        id=loan.id,
        book_id=loan.book_id,
        account_id=loan.account_id,
        account_name=loan.account.name if loan.account else "未知",
        name=loan.name,
        principal=float(loan.principal),
        remaining_principal=float(loan.remaining_principal),
        annual_rate=float(loan.annual_rate),
        total_months=loan.total_months,
        repaid_months=loan.repaid_months,
        monthly_payment=float(loan.monthly_payment),
        repayment_method=loan.repayment_method,
        start_date=loan.start_date,
        status=loan.status,
        total_interest=total_interest,
        created_at=loan.created_at,
    )


# ───── CRUD ─────


@router.get("/books/{book_id}/loans", response_model=list[LoanResponse])
async def list_loans(
    book_id: str,
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)
    stmt = (
        select(Loan)
        .options(selectinload(Loan.account))
        .where(Loan.book_id == book_id)
    )
    if status:
        stmt = stmt.where(Loan.status == status)
    stmt = stmt.order_by(Loan.created_at.desc())
    result = await db.execute(stmt)
    loans = list(result.scalars().all())
    return [_to_response(l) for l in loans]


@router.get("/loans/{loan_id}", response_model=LoanResponse)
async def get_loan(
    loan_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)
    return _to_response(loan)


@router.post("/books/{book_id}/loans", response_model=LoanResponse, status_code=201)
async def create_loan_endpoint(
    book_id: str,
    body: LoanCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)
    try:
        loan = await create_loan(
            db, book_id, body.account_id, body.name,
            body.principal, body.annual_rate, body.total_months,
            body.repayment_method, body.start_date,
            deposit_account_id=body.deposit_account_id,
            user_id=user.id,
        )
        await db.commit()
        loan = await get_loan_with_account(db, loan.id)
        return _to_response(loan)
    except LoanError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.put("/loans/{loan_id}", response_model=LoanResponse)
async def update_loan_endpoint(
    loan_id: str,
    body: LoanUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)

    if body.name is not None:
        loan.name = body.name
    if body.annual_rate is not None:
        loan.annual_rate = body.annual_rate
    await db.commit()
    await db.refresh(loan)
    loan = await get_loan_with_account(db, loan.id)
    return _to_response(loan)


@router.delete("/loans/{loan_id}", status_code=204)
async def delete_loan_endpoint(
    loan_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)
    await db.delete(loan)
    await db.commit()


# ───── 还款计划 ─────


@router.get("/loans/{loan_id}/schedule", response_model=list[RepaymentScheduleItem])
async def get_schedule(
    loan_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)

    schedule = generate_schedule(
        float(loan.principal), float(loan.annual_rate),
        loan.total_months, loan.repayment_method, loan.start_date,
        loan.repaid_months,
    )
    return schedule


# ───── 记录还款 ─────


@router.post("/loans/{loan_id}/repay", status_code=201)
async def repay_loan(
    loan_id: str,
    body: LoanRepayRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)

    try:
        entry = await record_repayment(
            db, loan, body.payment_account_id,
            body.interest_account_id, user.id, body.repay_date,
        )
        await db.commit()
        return {"entry_id": entry.id, "remaining_principal": float(loan.remaining_principal), "status": loan.status}
    except LoanError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.post("/loans/{loan_id}/prepay", status_code=201)
async def prepay_loan(
    loan_id: str,
    body: LoanPrepayRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await get_loan_with_account(db, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="贷款不存在")
    await _check_book(user.id, loan.book_id, db)

    try:
        entry = await record_prepayment(
            db, loan, body.amount, body.payment_account_id,
            body.interest_account_id, user.id, body.prepay_date,
        )
        await db.commit()
        return {"entry_id": entry.id, "remaining_principal": float(loan.remaining_principal), "status": loan.status}
    except LoanError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


# ───── 汇总 ─────


@router.get("/books/{book_id}/loans/summary", response_model=LoanSummary)
async def get_loan_summary(
    book_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_book(user.id, book_id, db)

    result = await db.execute(
        select(Loan).options(selectinload(Loan.account)).where(Loan.book_id == book_id)
    )
    loans = list(result.scalars().all())

    total_principal = sum(float(l.principal) for l in loans)
    total_remaining = sum(float(l.remaining_principal) for l in loans)
    total_paid_principal = total_principal - total_remaining
    active_count = sum(1 for l in loans if l.status == "active")

    # 已付利息 = 已还期数中的利息累计
    total_interest_paid = 0.0
    for l in loans:
        schedule = generate_schedule(
            float(l.principal), float(l.annual_rate),
            l.total_months, l.repayment_method, l.start_date,
            l.repaid_months,
        )
        total_interest_paid += sum(
            item["interest"] for item in schedule if item["is_paid"]
        )

    return LoanSummary(
        total_principal=round(total_principal, 2),
        total_remaining=round(total_remaining, 2),
        total_paid_principal=round(total_paid_principal, 2),
        total_interest_paid=round(total_interest_paid, 2),
        loan_count=len(loans),
        active_count=active_count,
    )
