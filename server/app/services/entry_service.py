"""核心记账逻辑 — 根据 entry_type 自动生成复式分录"""

from datetime import date
from decimal import Decimal

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.journal import JournalEntry, JournalLine
from app.models.account import Account
from app.models.asset import FixedAsset


class EntryError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


# ─────────────────────── helpers ───────────────────────

async def _get_account(db: AsyncSession, account_id: str, book_id: str) -> Account:
    """获取科目并校验归属"""
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.book_id == book_id,
            Account.is_active == True,
        )
    )
    acc = result.scalar_one_or_none()
    if not acc:
        raise EntryError(f"科目不存在或已停用: {account_id}", 404)
    return acc


def _check_balance(lines: list[JournalLine]):
    """校验借贷平衡"""
    total_debit = sum(Decimal(str(l.debit_amount)) for l in lines)
    total_credit = sum(Decimal(str(l.credit_amount)) for l in lines)
    if total_debit != total_credit:
        raise EntryError(
            f"借贷不平衡: 借方 {total_debit}，贷方 {total_credit}"
        )


def _make_line(
    account_id: str,
    debit: Decimal = Decimal("0"),
    credit: Decimal = Decimal("0"),
    description: str | None = None,
) -> JournalLine:
    return JournalLine(
        account_id=account_id,
        debit_amount=debit,
        credit_amount=credit,
        description=description,
    )


# ─────────────────────── 6 种快捷记账 ───────────────────────

async def create_expense(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    amount: Decimal,
    category_account_id: str,
    payment_account_id: str,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """记费用：借 费用科目，贷 资产/负债科目"""
    await _get_account(db, category_account_id, book_id)
    await _get_account(db, payment_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="expense",
        description=description,
        note=note,
    )
    lines = [
        _make_line(category_account_id, debit=amount),
        _make_line(payment_account_id, credit=amount),
    ]
    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


async def create_income(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    amount: Decimal,
    category_account_id: str,
    payment_account_id: str,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """记收入：借 资产科目，贷 收入科目"""
    await _get_account(db, payment_account_id, book_id)
    await _get_account(db, category_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="income",
        description=description,
        note=note,
    )
    lines = [
        _make_line(payment_account_id, debit=amount),
        _make_line(category_account_id, credit=amount),
    ]
    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


async def create_asset_purchase(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    amount: Decimal,
    asset_account_id: str,
    payment_account_id: str,
    description: str | None = None,
    note: str | None = None,
    extra_liability_account_id: str | None = None,
    extra_liability_amount: Decimal | None = None,
    # 折旧设置（科目为固定资产 1501 时必填）
    asset_name: str | None = None,
    useful_life_months: int | None = None,
    residual_rate: Decimal | None = None,
    depreciation_method: str | None = None,
    depreciation_granularity: str | None = None,
    # 贷款设置（选了额外负债科目时可选，自动创建贷款记录）
    loan_name: str | None = None,
    annual_rate: float | None = None,
    total_months: int | None = None,
    repayment_method: str | None = None,
    start_date: date | None = None,
) -> tuple[JournalEntry, str | None]:
    """购买资产：借 资产科目，贷 资产/负债科目（支持贷款买房等多贷方）
    
    当资产科目为固定资产（code=1501）时，自动创建 FixedAsset 记录。
    返回 (entry, asset_id)，asset_id 为创建的固定资产 ID，未创建时为 None。
    """
    asset_account = await _get_account(db, asset_account_id, book_id)
    await _get_account(db, payment_account_id, book_id)

    # 检查是否为固定资产科目（code 以 1501 开头）
    is_fixed_asset = asset_account.code and asset_account.code.startswith("1501")
    
    if is_fixed_asset and not asset_name:
        raise EntryError("固定资产科目必须填写资产名称")

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="asset_purchase",
        description=description,
        note=note,
    )

    # 总借方 = amount
    # 贷方 = payment_amount + extra_liability_amount
    if extra_liability_account_id and extra_liability_amount:
        await _get_account(db, extra_liability_account_id, book_id)
        payment_amount = amount - extra_liability_amount
        if payment_amount < 0:
            raise EntryError("额外负债金额不能超过总金额")
        lines = [_make_line(asset_account_id, debit=amount)]
        if payment_amount > 0:
            lines.append(_make_line(payment_account_id, credit=payment_amount))
        lines.append(_make_line(extra_liability_account_id, credit=extra_liability_amount))
    else:
        lines = [
            _make_line(asset_account_id, debit=amount),
            _make_line(payment_account_id, credit=amount),
        ]

    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)

    # 固定资产联动：自动创建 FixedAsset 记录
    asset_id = None
    if is_fixed_asset and asset_name:
        fixed_asset = FixedAsset(
            book_id=book_id,
            account_id=asset_account_id,
            name=asset_name,
            purchase_date=entry_date,
            original_cost=float(amount),
            residual_rate=float(residual_rate) if residual_rate is not None else 5.0,
            useful_life_months=useful_life_months if useful_life_months is not None else 36,
            depreciation_method=depreciation_method or "straight_line",
            depreciation_granularity=depreciation_granularity or "monthly",
        )
        db.add(fixed_asset)
        await db.flush()
        await db.refresh(fixed_asset)
        asset_id = fixed_asset.id

    # 贷款联动：选了额外负债科目且填写了贷款设置时，自动创建贷款记录
    if (extra_liability_account_id and extra_liability_amount
            and loan_name and annual_rate is not None and total_months and total_months > 0):
        from app.services.loan_service import create_loan as _create_loan
        await _create_loan(
            db,
            book_id=book_id,
            account_id=extra_liability_account_id,
            name=loan_name,
            principal=float(extra_liability_amount),
            annual_rate=annual_rate,
            total_months=total_months,
            repayment_method=repayment_method or "equal_installment",
            start_date=start_date or entry_date,
            deposit_account_id=None,
            user_id=None,
        )

    return entry, asset_id


async def create_borrow(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    amount: Decimal,
    payment_account_id: str,
    liability_account_id: str,
    description: str | None = None,
    note: str | None = None,
    # 贷款设置（可选，填写后自动创建贷款记录）
    loan_name: str | None = None,
    annual_rate: float | None = None,
    total_months: int | None = None,
    repayment_method: str | None = None,
    start_date: date | None = None,
) -> JournalEntry:
    """借入/贷款：借 资产科目，贷 负债科目。若提供贷款参数则同时创建贷款记录。"""
    await _get_account(db, payment_account_id, book_id)
    await _get_account(db, liability_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="borrow",
        description=description,
        note=note,
    )
    lines = [
        _make_line(payment_account_id, debit=amount),
        _make_line(liability_account_id, credit=amount),
    ]
    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)

    # 贷款联动：自动创建贷款记录（不再重复生成分录，分录已在上面创建）
    if loan_name and annual_rate is not None and total_months and total_months > 0:
        from app.services.loan_service import create_loan as _create_loan
        await _create_loan(
            db,
            book_id=book_id,
            account_id=liability_account_id,
            name=loan_name,
            principal=float(amount),
            annual_rate=annual_rate,
            total_months=total_months,
            repayment_method=repayment_method or "equal_installment",
            start_date=start_date or entry_date,
            deposit_account_id=None,  # 分录已经在上面创建，不再重复
            user_id=None,
        )

    return entry


async def create_repayment(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    principal: Decimal,
    interest: Decimal,
    liability_account_id: str,
    payment_account_id: str,
    category_account_id: str | None = None,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """还款：借 负债（本金）+ 利息费用，贷 资产科目"""
    await _get_account(db, liability_account_id, book_id)
    await _get_account(db, payment_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="repay",
        description=description,
        note=note,
    )

    total_credit = principal + interest
    lines = [
        _make_line(liability_account_id, debit=principal, description="本金"),
    ]

    if interest > 0:
        # 利息费用科目：如果传了 category_account_id 就用，否则利息也记到负债上
        if category_account_id:
            await _get_account(db, category_account_id, book_id)
            lines.append(
                _make_line(category_account_id, debit=interest, description="利息")
            )
        else:
            # 没有指定利息科目时，利息也作为借方
            lines.append(
                _make_line(liability_account_id, debit=interest, description="利息")
            )
            total_credit = principal + interest

    lines.append(
        _make_line(payment_account_id, credit=total_credit)
    )

    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


async def create_transfer(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    amount: Decimal,
    from_account_id: str,
    to_account_id: str,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """账户互转：借 目标资产，贷 来源资产"""
    await _get_account(db, from_account_id, book_id)
    await _get_account(db, to_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="transfer",
        description=description,
        note=note,
    )
    lines = [
        _make_line(to_account_id, debit=amount),
        _make_line(from_account_id, credit=amount),
    ]
    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


async def create_manual_entry(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    entry_date: date,
    lines_data: list[dict],
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """手动分录：直接传入 lines"""
    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="manual",
        description=description,
        note=note,
    )
    lines = []
    for ld in lines_data:
        await _get_account(db, ld["account_id"], book_id)
        lines.append(
            _make_line(
                ld["account_id"],
                debit=Decimal(str(ld.get("debit_amount", 0))),
                credit=Decimal(str(ld.get("credit_amount", 0))),
                description=ld.get("description"),
            )
        )
    _check_balance(lines)
    entry.lines = lines
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


# ─────────────────────── CRUD ───────────────────────

async def get_entry_detail(
    db: AsyncSession, entry_id: str
) -> JournalEntry | None:
    """获取分录详情（含 lines + 科目信息）"""
    result = await db.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
        .where(JournalEntry.id == entry_id)
    )
    return result.scalar_one_or_none()


async def get_entries_paginated(
    db: AsyncSession,
    book_id: str,
    page: int = 1,
    page_size: int = 20,
    entry_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    account_id: str | None = None,
) -> tuple[list[JournalEntry], int]:
    """分录列表（分页 + 筛选）"""
    conditions = [JournalEntry.book_id == book_id]

    if entry_type:
        conditions.append(JournalEntry.entry_type == entry_type)
    if start_date:
        conditions.append(JournalEntry.entry_date >= start_date)
    if end_date:
        conditions.append(JournalEntry.entry_date <= end_date)

    # 按科目筛选：找包含该科目的分录
    if account_id:
        sub = (
            select(JournalLine.entry_id)
            .where(JournalLine.account_id == account_id)
            .subquery()
        )
        conditions.append(JournalEntry.id.in_(select(sub.c.entry_id)))

    where_clause = and_(*conditions)

    # 总数
    count_result = await db.execute(
        select(func.count()).select_from(JournalEntry).where(where_clause)
    )
    total = count_result.scalar() or 0

    # 数据（预加载 lines + account 以计算净资产影响）
    result = await db.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines).selectinload(JournalLine.account))
        .where(where_clause)
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    entries = list(result.scalars().all())

    return entries, total


async def update_entry(
    db: AsyncSession,
    entry: JournalEntry,
    entry_date: date | None = None,
    description: str | None = None,
    note: str | None = None,
) -> JournalEntry:
    """编辑分录（仅编辑元数据，不修改 lines）"""
    if entry_date is not None:
        entry.entry_date = entry_date
    if description is not None:
        entry.description = description
    if note is not None:
        entry.note = note
    await db.flush()
    await db.refresh(entry)
    return entry


async def delete_entry(db: AsyncSession, entry: JournalEntry) -> None:
    """删除分录（级联删除 lines）"""
    await db.delete(entry)
    await db.flush()
