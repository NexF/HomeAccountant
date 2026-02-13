"""贷款计算引擎 — 等额本息/等额本金、还款计划、记录还款"""

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from dateutil.relativedelta import relativedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.loan import Loan
from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine


class LoanError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


# ─────────────────────── 计算引擎 ───────────────────────


def calc_equal_installment_payment(principal: float, annual_rate: float, total_months: int) -> float:
    """等额本息：月供 = P * r * (1+r)^n / ((1+r)^n - 1)"""
    r = Decimal(str(annual_rate)) / Decimal("1200")  # 月利率
    p = Decimal(str(principal))
    n = total_months

    if r == 0:
        return float((p / n).quantize(Decimal("0.01"), ROUND_HALF_UP))

    factor = (1 + r) ** n
    payment = p * r * factor / (factor - 1)
    return float(payment.quantize(Decimal("0.01"), ROUND_HALF_UP))


def calc_equal_principal_first_payment(principal: float, annual_rate: float, total_months: int) -> float:
    """等额本金：第一期月供（最大月供）"""
    r = Decimal(str(annual_rate)) / Decimal("1200")
    p = Decimal(str(principal))
    n = total_months
    principal_part = p / n
    interest_part = p * r
    return float((principal_part + interest_part).quantize(Decimal("0.01"), ROUND_HALF_UP))


def generate_schedule(
    principal: float,
    annual_rate: float,
    total_months: int,
    repayment_method: str,
    start_date: date,
    repaid_months: int = 0,
    remaining_principal: float | None = None,
) -> list[dict]:
    """生成完整还款计划表"""
    r = Decimal(str(annual_rate)) / Decimal("1200")
    p = Decimal(str(principal))
    n = total_months
    schedule = []

    if repayment_method == "equal_installment":
        if r == 0:
            monthly_payment = p / n
        else:
            factor = (1 + r) ** n
            monthly_payment = p * r * factor / (factor - 1)

        remaining = p
        for i in range(1, n + 1):
            interest = (remaining * r).quantize(Decimal("0.01"), ROUND_HALF_UP)
            if i == n:
                principal_part = remaining
                payment = principal_part + interest
            else:
                payment = monthly_payment.quantize(Decimal("0.01"), ROUND_HALF_UP)
                principal_part = payment - interest
            remaining -= principal_part

            payment_date = start_date + relativedelta(months=i - 1)
            schedule.append({
                "period": i,
                "payment_date": payment_date,
                "payment": float(payment.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "principal": float(principal_part.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "interest": float(interest),
                "remaining": float(max(remaining, Decimal("0")).quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "is_paid": i <= repaid_months,
            })
    else:
        # 等额本金
        principal_part = (p / n).quantize(Decimal("0.01"), ROUND_HALF_UP)
        remaining = p
        for i in range(1, n + 1):
            interest = (remaining * r).quantize(Decimal("0.01"), ROUND_HALF_UP)
            if i == n:
                actual_principal = remaining
            else:
                actual_principal = principal_part
            payment = actual_principal + interest
            remaining -= actual_principal

            payment_date = start_date + relativedelta(months=i - 1)
            schedule.append({
                "period": i,
                "payment_date": payment_date,
                "payment": float(payment.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "principal": float(actual_principal.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "interest": float(interest),
                "remaining": float(max(remaining, Decimal("0")).quantize(Decimal("0.01"), ROUND_HALF_UP)),
                "is_paid": i <= repaid_months,
            })

    return schedule


def calc_total_interest(principal: float, annual_rate: float, total_months: int, repayment_method: str, start_date: date) -> float:
    """计算利息总额"""
    schedule = generate_schedule(principal, annual_rate, total_months, repayment_method, start_date)
    return round(sum(item["interest"] for item in schedule), 2)


# ─────────────────────── CRUD ───────────────────────


async def create_loan(
    db: AsyncSession,
    book_id: str,
    account_id: str,
    name: str,
    principal: float,
    annual_rate: float,
    total_months: int,
    repayment_method: str,
    start_date: date,
    deposit_account_id: str | None = None,
    user_id: str | None = None,
) -> Loan:
    """创建贷款，若提供 deposit_account_id 则自动生成借款入账分录"""
    # 校验负债科目
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.book_id == book_id, Account.is_active == True)
    )
    acct = result.scalar_one_or_none()
    if not acct:
        raise LoanError("负债科目不存在或已停用", 404)
    if acct.type != "liability":
        raise LoanError("贷款必须关联负债类科目")

    # 校验放款资产账户
    if deposit_account_id:
        result = await db.execute(
            select(Account).where(Account.id == deposit_account_id, Account.book_id == book_id, Account.is_active == True)
        )
        deposit_acct = result.scalar_one_or_none()
        if not deposit_acct:
            raise LoanError("放款资产账户不存在或已停用", 404)
        if deposit_acct.type != "asset":
            raise LoanError("放款账户必须是资产类科目")

    # 计算月供
    if repayment_method == "equal_installment":
        monthly_payment = calc_equal_installment_payment(principal, annual_rate, total_months)
    else:
        monthly_payment = calc_equal_principal_first_payment(principal, annual_rate, total_months)

    loan = Loan(
        book_id=book_id,
        account_id=account_id,
        name=name,
        principal=principal,
        remaining_principal=principal,
        annual_rate=annual_rate,
        total_months=total_months,
        monthly_payment=monthly_payment,
        repayment_method=repayment_method,
        start_date=start_date,
    )
    db.add(loan)
    await db.flush()

    # 自动生成借款入账分录：借 资产账户，贷 负债账户
    if deposit_account_id and user_id:
        principal_amount = Decimal(str(principal))
        entry = JournalEntry(
            book_id=book_id,
            user_id=user_id,
            entry_date=start_date,
            entry_type="borrow",
            description=f"贷款放款 - {name}",
        )
        entry.lines = [
            JournalLine(
                account_id=deposit_account_id,
                debit_amount=principal_amount,
                credit_amount=Decimal("0"),
                description="收到贷款",
            ),
            JournalLine(
                account_id=account_id,
                debit_amount=Decimal("0"),
                credit_amount=principal_amount,
                description="贷款负债",
            ),
        ]
        db.add(entry)
        await db.flush()

    await db.refresh(loan)
    return loan


async def get_loan_with_account(db: AsyncSession, loan_id: str) -> Loan | None:
    result = await db.execute(
        select(Loan).options(selectinload(Loan.account)).where(Loan.id == loan_id)
    )
    return result.scalar_one_or_none()


async def record_repayment(
    db: AsyncSession,
    loan: Loan,
    payment_account_id: str,
    interest_account_id: str | None,
    user_id: str,
    repay_date: date | None = None,
) -> JournalEntry:
    """记录一期还款：按还款计划自动计算本金和利息"""
    if loan.status == "paid_off":
        raise LoanError("该贷款已结清")

    schedule = generate_schedule(
        float(loan.principal), float(loan.annual_rate),
        loan.total_months, loan.repayment_method, loan.start_date,
        loan.repaid_months,
    )

    next_period = loan.repaid_months + 1
    if next_period > loan.total_months:
        raise LoanError("所有期数已还完")

    item = schedule[next_period - 1]
    principal_amount = Decimal(str(item["principal"]))
    interest_amount = Decimal(str(item["interest"]))
    total_payment = principal_amount + interest_amount

    actual_date = repay_date or date.today()

    # 校验还款账户
    result = await db.execute(
        select(Account).where(Account.id == payment_account_id, Account.book_id == loan.book_id)
    )
    if not result.scalar_one_or_none():
        raise LoanError("还款账户不存在", 404)

    # 创建还款分录
    entry = JournalEntry(
        book_id=loan.book_id,
        user_id=user_id,
        entry_date=actual_date,
        entry_type="repay",
        description=f"还款 - {loan.name} 第{next_period}期",
    )

    lines = [
        JournalLine(
            account_id=loan.account_id,
            debit_amount=principal_amount,
            credit_amount=Decimal("0"),
            description="本金",
        ),
    ]

    if interest_amount > 0:
        if interest_account_id:
            result = await db.execute(
                select(Account).where(Account.id == interest_account_id, Account.book_id == loan.book_id)
            )
            if not result.scalar_one_or_none():
                raise LoanError("利息费用科目不存在", 404)
            lines.append(JournalLine(
                account_id=interest_account_id,
                debit_amount=interest_amount,
                credit_amount=Decimal("0"),
                description="利息",
            ))
        else:
            lines.append(JournalLine(
                account_id=loan.account_id,
                debit_amount=interest_amount,
                credit_amount=Decimal("0"),
                description="利息",
            ))

    lines.append(JournalLine(
        account_id=payment_account_id,
        debit_amount=Decimal("0"),
        credit_amount=total_payment,
        description="还款支出",
    ))

    entry.lines = lines
    db.add(entry)

    # 更新贷款状态
    loan.repaid_months = next_period
    loan.remaining_principal = float(
        Decimal(str(loan.remaining_principal)) - principal_amount
    )
    if loan.remaining_principal <= 0.01:
        loan.remaining_principal = 0
        loan.status = "paid_off"

    await db.flush()
    await db.refresh(entry)
    return entry


async def record_prepayment(
    db: AsyncSession,
    loan: Loan,
    amount: float,
    payment_account_id: str,
    interest_account_id: str | None,
    user_id: str,
    prepay_date: date | None = None,
) -> JournalEntry:
    """提前还款：直接偿还本金"""
    if loan.status == "paid_off":
        raise LoanError("该贷款已结清")

    remaining = Decimal(str(loan.remaining_principal))
    prepay_amount = Decimal(str(amount))

    if prepay_amount > remaining:
        raise LoanError(f"提前还款金额({amount})不能超过剩余本金({float(remaining)})")

    actual_date = prepay_date or date.today()

    # 校验
    result = await db.execute(
        select(Account).where(Account.id == payment_account_id, Account.book_id == loan.book_id)
    )
    if not result.scalar_one_or_none():
        raise LoanError("还款账户不存在", 404)

    entry = JournalEntry(
        book_id=loan.book_id,
        user_id=user_id,
        entry_date=actual_date,
        entry_type="repay",
        description=f"提前还款 - {loan.name}",
    )

    lines = [
        JournalLine(
            account_id=loan.account_id,
            debit_amount=prepay_amount,
            credit_amount=Decimal("0"),
            description="提前还款本金",
        ),
        JournalLine(
            account_id=payment_account_id,
            debit_amount=Decimal("0"),
            credit_amount=prepay_amount,
            description="提前还款支出",
        ),
    ]

    entry.lines = lines
    db.add(entry)

    loan.remaining_principal = float(remaining - prepay_amount)
    if loan.remaining_principal <= 0.01:
        loan.remaining_principal = 0
        loan.status = "paid_off"

    await db.flush()
    await db.refresh(entry)
    return entry
