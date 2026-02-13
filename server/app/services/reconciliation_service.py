"""
对账服务：余额快照、差异计算、调节分录生成、确认分类、拆分
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
            JournalEntry.entry_date <= as_of_date,
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
) -> dict:
    """
    记录外部余额快照，计算差异，如差异!=0 则自动生成调节分录。
    """
    target_date = snapshot_date or date.today()

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
    difference = external_balance - book_balance

    # 创建快照
    snapshot = BalanceSnapshot(
        data_source_id=data_source.id,
        account_id=account_id,
        snapshot_date=target_date,
        external_balance=float(external_balance),
        book_balance=float(book_balance),
        difference=float(difference),
        status="balanced" if abs(difference) < Decimal("0.01") else "pending",
    )

    reconciliation_entry = None

    # 差异 != 0 → 自动生成调节分录
    if abs(difference) >= Decimal("0.01"):
        # 找到 "待分类费用" 或 "待分类收入" 科目，若不存在就用通用科目
        if difference > 0:
            # 外部余额 > 账本余额 → 资产多了 → 待分类收入
            suspense_type = "income"
            suspense_name = "待分类收入"
        else:
            # 外部余额 < 账本余额 → 资产少了 → 待分类费用
            suspense_type = "expense"
            suspense_name = "待分类费用"

        # 查找或创建暂挂科目
        suspense_result = await db.execute(
            select(Account).where(
                Account.book_id == book_id,
                Account.name == suspense_name,
                Account.type == suspense_type,
                Account.is_active == True,
            )
        )
        suspense_account = suspense_result.scalar_one_or_none()
        if not suspense_account:
            suspense_account = Account(
                book_id=book_id,
                code=f"9901" if suspense_type == "expense" else "9801",
                name=suspense_name,
                type=suspense_type,
                balance_direction="debit" if suspense_type == "expense" else "credit",
                is_system=True,
                sort_order=999,
            )
            db.add(suspense_account)
            await db.flush()

        abs_diff = abs(difference)

        entry = JournalEntry(
            book_id=book_id,
            user_id=user_id,
            entry_date=target_date,
            entry_type="reconciliation",
            description=f"对账调节：{account.name}",
            source="reconciliation",
            reconciliation_status="pending",
        )

        if difference > 0:
            # 资产增加：借 资产科目，贷 待分类收入
            lines = [
                JournalLine(account_id=account_id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=suspense_account.id, debit_amount=0, credit_amount=abs_diff),
            ]
        else:
            # 资产减少：借 待分类费用，贷 资产科目
            lines = [
                JournalLine(account_id=suspense_account.id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=account_id, debit_amount=0, credit_amount=abs_diff),
            ]

        entry.lines = lines
        db.add(entry)
        await db.flush()
        snapshot.reconciliation_entry_id = entry.id
        reconciliation_entry = entry

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
        "reconciliation_entry_id": reconciliation_entry.id if reconciliation_entry else None,
    }


async def get_pending_reconciliations(
    db: AsyncSession,
    book_id: str,
) -> list[dict]:
    """获取待处理的调节队列"""
    stmt = (
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
        .where(
            JournalEntry.book_id == book_id,
            JournalEntry.entry_type == "reconciliation",
            JournalEntry.reconciliation_status == "pending",
        )
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
    )
    result = await db.execute(stmt)
    entries = result.scalars().all()

    items = []
    for e in entries:
        # 找到关联的 snapshot
        snap_result = await db.execute(
            select(BalanceSnapshot).where(
                BalanceSnapshot.reconciliation_entry_id == e.id
            )
        )
        snap = snap_result.scalar_one_or_none()

        lines_data = []
        for l in e.lines:
            lines_data.append({
                "id": l.id,
                "account_id": l.account_id,
                "account_name": l.account.name if l.account else None,
                "account_code": l.account.code if l.account else None,
                "account_type": l.account.type if l.account else None,
                "debit_amount": float(l.debit_amount),
                "credit_amount": float(l.credit_amount),
            })

        items.append({
            "entry_id": e.id,
            "entry_date": e.entry_date.isoformat(),
            "description": e.description,
            "lines": lines_data,
            "snapshot": {
                "snapshot_id": snap.id,
                "account_id": snap.account_id,
                "snapshot_date": snap.snapshot_date.isoformat(),
                "external_balance": float(snap.external_balance),
                "book_balance": float(snap.book_balance),
                "difference": float(snap.difference),
            } if snap else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })

    return items


async def get_pending_count(
    db: AsyncSession,
    book_id: str,
) -> int:
    """获取待处理调节数量（用于角标）"""
    result = await db.execute(
        select(func.count()).select_from(JournalEntry).where(
            JournalEntry.book_id == book_id,
            JournalEntry.entry_type == "reconciliation",
            JournalEntry.reconciliation_status == "pending",
        )
    )
    return result.scalar() or 0


async def confirm_reconciliation(
    db: AsyncSession,
    entry_id: str,
    target_account_id: str,
    book_id: str,
) -> dict:
    """
    确认调节分录的分类：将暂挂科目替换为用户指定的目标科目。
    """
    # 获取分录
    result = await db.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
        .where(JournalEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise ReconciliationError("分录不存在", 404)
    if entry.reconciliation_status != "pending":
        raise ReconciliationError("该分录已处理")

    # 校验目标科目
    target_result = await db.execute(
        select(Account).where(
            Account.id == target_account_id,
            Account.book_id == book_id,
            Account.is_active == True,
        )
    )
    target_account = target_result.scalar_one_or_none()
    if not target_account:
        raise ReconciliationError("目标科目不存在", 404)

    # 找到暂挂科目行（待分类费用/待分类收入），替换为目标科目
    for line in entry.lines:
        if line.account and line.account.name in ("待分类费用", "待分类收入"):
            line.account_id = target_account_id

    entry.reconciliation_status = "confirmed"

    # 更新关联 snapshot 状态
    snap_result = await db.execute(
        select(BalanceSnapshot).where(
            BalanceSnapshot.reconciliation_entry_id == entry_id
        )
    )
    snap = snap_result.scalar_one_or_none()
    if snap:
        snap.status = "reconciled"

    await db.flush()
    await db.refresh(entry)

    return {
        "entry_id": entry.id,
        "reconciliation_status": entry.reconciliation_status,
        "target_account_id": target_account_id,
        "target_account_name": target_account.name,
    }


async def split_reconciliation(
    db: AsyncSession,
    entry_id: str,
    book_id: str,
    user_id: str,
    splits: list[dict],
) -> dict:
    """
    拆分调节分录。splits 格式：
    [{"account_id": "xxx", "amount": 50.00, "description": "..."}, ...]
    总金额必须等于原差异金额。
    """
    # 获取原分录
    result = await db.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
        .where(JournalEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise ReconciliationError("分录不存在", 404)
    if entry.reconciliation_status != "pending":
        raise ReconciliationError("该分录已处理")

    # 找出暂挂科目行和资产科目行
    suspense_line = None
    asset_line = None
    for line in entry.lines:
        if line.account and line.account.name in ("待分类费用", "待分类收入"):
            suspense_line = line
        else:
            asset_line = line

    if not suspense_line or not asset_line:
        raise ReconciliationError("无法解析调节分录结构")

    # 确定方向：暂挂在借方 = 费用类；暂挂在贷方 = 收入类
    is_expense = float(suspense_line.debit_amount) > 0
    total_amount = Decimal(str(
        suspense_line.debit_amount if is_expense else suspense_line.credit_amount
    ))

    # 校验拆分金额
    splits_total = sum(Decimal(str(s["amount"])) for s in splits)
    if abs(splits_total - total_amount) >= Decimal("0.01"):
        raise ReconciliationError(
            f"拆分金额合计 {splits_total} 不等于原差异金额 {total_amount}"
        )

    # 删除旧的暂挂行
    await db.delete(suspense_line)

    # 创建新的明细行
    for s in splits:
        # 校验科目
        acc_result = await db.execute(
            select(Account).where(
                Account.id == s["account_id"],
                Account.book_id == book_id,
                Account.is_active == True,
            )
        )
        acc = acc_result.scalar_one_or_none()
        if not acc:
            raise ReconciliationError(f"科目不存在: {s['account_id']}", 404)

        amount = Decimal(str(s["amount"]))
        new_line = JournalLine(
            entry_id=entry_id,
            account_id=s["account_id"],
            debit_amount=float(amount) if is_expense else 0,
            credit_amount=float(amount) if not is_expense else 0,
            description=s.get("description"),
        )
        db.add(new_line)

    entry.reconciliation_status = "confirmed"

    # 更新关联 snapshot
    snap_result = await db.execute(
        select(BalanceSnapshot).where(
            BalanceSnapshot.reconciliation_entry_id == entry_id
        )
    )
    snap = snap_result.scalar_one_or_none()
    if snap:
        snap.status = "reconciled"

    await db.flush()

    return {
        "entry_id": entry.id,
        "reconciliation_status": "confirmed",
        "splits_count": len(splits),
    }
