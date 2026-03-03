"""对账服务：余额快照、差异计算、调节分录生成"""

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine
from app.models.sync import DataSource, BalanceSnapshot


class ReconciliationError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


async def _get_book_balance(
    db: AsyncSession, account_id: str, book_id: str, as_of_date: date
) -> Decimal:
    """计算指定科目截至指定日期的账本余额"""
    account = await db.get(Account, account_id)
    if not account:
        raise ReconciliationError("科目不存在", 404)

    stmt = (
        select(
            func.coalesce(func.sum(JournalLine.debit_amount), 0).label("total_debit"),
            func.coalesce(func.sum(JournalLine.credit_amount), 0).label("total_credit"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(
            JournalLine.account_id == account_id,
            JournalEntry.book_id == book_id,
            JournalEntry.entry_date < datetime(as_of_date.year, as_of_date.month, as_of_date.day) + timedelta(days=1),
        )
    )
    result = await db.execute(stmt)
    row = result.one()

    total_debit = Decimal(str(row.total_debit))
    total_credit = Decimal(str(row.total_credit))

    if account.balance_direction == "debit":
        return total_debit - total_credit
    else:
        return total_credit - total_debit


async def create_snapshot(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    account_id: str,
    external_balance: Decimal,
    snapshot_date: date | None = None,
    adjust_account_id: str | None = None,
    adjust_income_account_id: str | None = None,
    adjust_expense_account_id: str | None = None,
) -> dict:
    """
    记录外部余额快照，计算差异，如差异!=0 则自动生成调节分录。
    """
    target_date = snapshot_date or date.today()
    entry_datetime = datetime.now().replace(microsecond=0)

    # 校验科目
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.book_id == book_id,
            Account.is_active == True,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise ReconciliationError("科目不存在或已停用", 404)

    # 确保 data_source 存在（自动创建 manual 类型）
    ds_result = await db.execute(
        select(DataSource).where(
            DataSource.account_id == account_id,
            DataSource.book_id == book_id,
            DataSource.source_type == "manual",
        )
    )
    data_source = ds_result.scalar_one_or_none()
    if not data_source:
        data_source = DataSource(
            book_id=book_id,
            account_id=account_id,
            source_type="manual",
            provider_name="手动输入",
            sync_frequency="manual",
            status="active",
        )
        db.add(data_source)
        await db.flush()

    # 计算账本余额
    book_balance = await _get_book_balance(db, account_id, book_id, target_date)
    difference = (external_balance - book_balance).quantize(Decimal("0.01"))

    # 创建快照（先设 balanced，后续根据差异可能更新为 reconciled）
    snapshot = BalanceSnapshot(
        data_source_id=data_source.id,
        account_id=account_id,
        snapshot_date=target_date,
        external_balance=float(external_balance),
        book_balance=float(book_balance),
        difference=float(difference),
        status="balanced",
    )

    # 差异 >= 0.01 → 生成调节分录
    if abs(difference) >= Decimal("0.01"):
        # 确定调账科目：方向专用 > 通用单科目 > 系统默认
        direction_account_id = (
            adjust_income_account_id if difference > 0 else adjust_expense_account_id
        )
        effective_adjust_id = direction_account_id or adjust_account_id

        if effective_adjust_id:
            adj_result = await db.execute(
                select(Account).where(
                    Account.id == effective_adjust_id,
                    Account.book_id == book_id,
                    Account.is_active == True,
                )
            )
            adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                raise ReconciliationError("调账科目不存在或已停用", 404)
        else:
            # 回退到系统默认科目
            if difference > 0:
                default_code, default_name, default_type = "4009", "其他收入", "income"
            else:
                default_code, default_name, default_type = "5099", "其他费用", "expense"

            adj_result = await db.execute(
                select(Account).where(
                    Account.book_id == book_id,
                    Account.code == default_code,
                    Account.is_active == True,
                )
            )
            adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                # 查找同名科目
                adj_result = await db.execute(
                    select(Account).where(
                        Account.book_id == book_id,
                        Account.name == default_name,
                        Account.type == default_type,
                        Account.is_active == True,
                    )
                )
                adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                # 自动创建默认科目
                adjust_account = Account(
                    book_id=book_id,
                    code=default_code,
                    name=default_name,
                    type=default_type,
                    balance_direction="credit" if default_type == "income" else "debit",
                    is_system=True,
                    sort_order=999,
                )
                db.add(adjust_account)
                await db.flush()

        abs_diff = abs(difference).quantize(Decimal("0.01"))

        entry = JournalEntry(
            book_id=book_id,
            user_id=user_id,
            entry_date=entry_datetime,
            entry_type="reconciliation",
            description=f"余额调节：{account.name}",
            source="reconciliation",
        )

        if difference > 0:
            # 实际 > 账面：借 资产科目，贷 调账科目
            lines = [
                JournalLine(account_id=account_id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=adjust_account.id, debit_amount=0, credit_amount=abs_diff),
            ]
        else:
            # 实际 < 账面：借 调账科目，贷 资产科目
            lines = [
                JournalLine(account_id=adjust_account.id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=account_id, debit_amount=0, credit_amount=abs_diff),
            ]

        entry.lines = lines
        db.add(entry)
        await db.flush()
        snapshot.reconciliation_entry_id = entry.id
        snapshot.status = "reconciled"

    db.add(snapshot)
    await db.flush()
    await db.refresh(snapshot)

    return {
        "snapshot_id": snapshot.id,
        "account_id": account_id,
        "account_name": account.name,
        "account_type": account.type,
        "snapshot_date": target_date.isoformat(),
        "external_balance": float(external_balance),
        "book_balance": float(book_balance),
        "difference": float(difference),
        "status": snapshot.status,
    }
