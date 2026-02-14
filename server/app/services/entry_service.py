"""核心记账逻辑 — 根据 entry_type 自动生成复式分录"""

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, func, and_, delete
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


# ─────────────────── 分录行构造（共用） ───────────────────


def _build_expense_lines(
    amount: Decimal,
    category_account_id: str,
    payment_account_id: str,
) -> list[JournalLine]:
    """费用：借 费用科目，贷 资产/负债科目"""
    return [
        _make_line(category_account_id, debit=amount),
        _make_line(payment_account_id, credit=amount),
    ]


def _build_income_lines(
    amount: Decimal,
    payment_account_id: str,
    category_account_id: str,
) -> list[JournalLine]:
    """收入：借 资产科目，贷 收入科目"""
    return [
        _make_line(payment_account_id, debit=amount),
        _make_line(category_account_id, credit=amount),
    ]


def _build_asset_purchase_lines(
    amount: Decimal,
    asset_account_id: str,
    payment_account_id: str,
    extra_liability_account_id: str | None = None,
    extra_liability_amount: Decimal | None = None,
) -> list[JournalLine]:
    """购买资产：借 资产科目，贷 资产/负债科目（支持多贷方）"""
    if extra_liability_account_id and extra_liability_amount:
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
    return lines


def _build_borrow_lines(
    amount: Decimal,
    payment_account_id: str,
    liability_account_id: str,
) -> list[JournalLine]:
    """借入/贷款：借 资产科目，贷 负债科目"""
    return [
        _make_line(payment_account_id, debit=amount),
        _make_line(liability_account_id, credit=amount),
    ]


def _build_repay_lines(
    principal: Decimal,
    interest: Decimal,
    liability_account_id: str,
    payment_account_id: str,
    category_account_id: str | None = None,
) -> list[JournalLine]:
    """还款：借 负债（本金）+ 利息费用，贷 资产科目"""
    total_credit = principal + interest
    lines = [
        _make_line(liability_account_id, debit=principal, description="本金"),
    ]
    if interest > 0:
        if category_account_id:
            lines.append(
                _make_line(category_account_id, debit=interest, description="利息")
            )
        else:
            lines.append(
                _make_line(liability_account_id, debit=interest, description="利息")
            )
            total_credit = principal + interest
    lines.append(
        _make_line(payment_account_id, credit=total_credit)
    )
    return lines


def _build_transfer_lines(
    amount: Decimal,
    from_account_id: str,
    to_account_id: str,
) -> list[JournalLine]:
    """账户互转：借 目标资产，贷 来源资产"""
    return [
        _make_line(to_account_id, debit=amount),
        _make_line(from_account_id, credit=amount),
    ]


async def _build_manual_lines(
    db: AsyncSession,
    book_id: str,
    lines_data: list[dict],
) -> list[JournalLine]:
    """手动分录：直接传入 lines"""
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
    return lines


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
    lines = _build_expense_lines(amount, category_account_id, payment_account_id)
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
    lines = _build_income_lines(amount, payment_account_id, category_account_id)
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

    if extra_liability_account_id and extra_liability_amount:
        await _get_account(db, extra_liability_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="asset_purchase",
        description=description,
        note=note,
    )

    lines = _build_asset_purchase_lines(
        amount, asset_account_id, payment_account_id,
        extra_liability_account_id, extra_liability_amount,
    )

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
    lines = _build_borrow_lines(amount, payment_account_id, liability_account_id)
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
    if category_account_id:
        await _get_account(db, category_account_id, book_id)

    entry = JournalEntry(
        book_id=book_id,
        user_id=user_id,
        entry_date=entry_date,
        entry_type="repay",
        description=description,
        note=note,
    )

    lines = _build_repay_lines(
        principal, interest, liability_account_id,
        payment_account_id, category_account_id,
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
    lines = _build_transfer_lines(amount, from_account_id, to_account_id)
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
    lines = await _build_manual_lines(db, book_id, lines_data)
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


def _has_business_fields(body) -> bool:
    """判断更新请求中是否包含业务字段（需要重建 lines）"""
    business_fields = [
        "amount", "category_account_id", "payment_account_id",
        "asset_account_id", "liability_account_id",
        "from_account_id", "to_account_id",
        "extra_liability_account_id", "extra_liability_amount",
        "principal", "interest", "lines",
    ]
    for field in business_fields:
        if getattr(body, field, None) is not None:
            return True
    return False


async def _rebuild_lines(
    db: AsyncSession,
    entry: JournalEntry,
    body,
) -> list[JournalLine]:
    """按 entry_type 重新构造 journal_lines"""
    etype = entry.entry_type

    if etype == "expense":
        if not body.amount or not body.category_account_id or not body.payment_account_id:
            raise EntryError("费用分录需要 amount, category_account_id, payment_account_id")
        await _get_account(db, body.category_account_id, entry.book_id)
        await _get_account(db, body.payment_account_id, entry.book_id)
        return _build_expense_lines(body.amount, body.category_account_id, body.payment_account_id)

    elif etype == "income":
        if not body.amount or not body.category_account_id or not body.payment_account_id:
            raise EntryError("收入分录需要 amount, category_account_id, payment_account_id")
        await _get_account(db, body.payment_account_id, entry.book_id)
        await _get_account(db, body.category_account_id, entry.book_id)
        return _build_income_lines(body.amount, body.payment_account_id, body.category_account_id)

    elif etype == "asset_purchase":
        if not body.amount or not body.asset_account_id or not body.payment_account_id:
            raise EntryError("购买资产需要 amount, asset_account_id, payment_account_id")
        await _get_account(db, body.asset_account_id, entry.book_id)
        await _get_account(db, body.payment_account_id, entry.book_id)
        if body.extra_liability_account_id and body.extra_liability_amount:
            await _get_account(db, body.extra_liability_account_id, entry.book_id)
        return _build_asset_purchase_lines(
            body.amount, body.asset_account_id, body.payment_account_id,
            body.extra_liability_account_id, body.extra_liability_amount,
        )

    elif etype == "borrow":
        if not body.amount or not body.payment_account_id or not body.liability_account_id:
            raise EntryError("借入需要 amount, payment_account_id, liability_account_id")
        await _get_account(db, body.payment_account_id, entry.book_id)
        await _get_account(db, body.liability_account_id, entry.book_id)
        return _build_borrow_lines(body.amount, body.payment_account_id, body.liability_account_id)

    elif etype == "repay":
        if body.principal is None or body.interest is None:
            raise EntryError("还款需要 principal, interest")
        if not body.liability_account_id or not body.payment_account_id:
            raise EntryError("还款需要 liability_account_id, payment_account_id")
        await _get_account(db, body.liability_account_id, entry.book_id)
        await _get_account(db, body.payment_account_id, entry.book_id)
        if body.category_account_id:
            await _get_account(db, body.category_account_id, entry.book_id)
        return _build_repay_lines(
            body.principal, body.interest, body.liability_account_id,
            body.payment_account_id, body.category_account_id,
        )

    elif etype == "transfer":
        if not body.amount or not body.from_account_id or not body.to_account_id:
            raise EntryError("转账需要 amount, from_account_id, to_account_id")
        await _get_account(db, body.from_account_id, entry.book_id)
        await _get_account(db, body.to_account_id, entry.book_id)
        return _build_transfer_lines(body.amount, body.from_account_id, body.to_account_id)

    elif etype == "manual":
        if not body.lines or len(body.lines) < 2:
            raise EntryError("手动分录至少需要 2 行")
        lines_data = [l if isinstance(l, dict) else l.model_dump() for l in body.lines]
        return await _build_manual_lines(db, entry.book_id, lines_data)

    else:
        raise EntryError(f"不支持的分录类型: {etype}")


async def update_entry(
    db: AsyncSession,
    entry: JournalEntry,
    body,
) -> JournalEntry:
    """
    完整编辑分录：
    1. 更新元数据（entry_date, description, note）
    2. 如果提供了业务字段（amount, account_id 等），删除旧 lines 并重新生成
    3. 校验借贷平衡
    4. entry.id 和 created_at 不变
    """
    # Step 1: 更新元数据
    if getattr(body, "entry_date", None) is not None:
        entry.entry_date = body.entry_date
    if getattr(body, "description", None) is not None:
        entry.description = body.description
    if getattr(body, "note", None) is not None:
        entry.note = body.note

    # Step 2: 判断是否需要重建 lines
    if _has_business_fields(body):
        # Step 2a: 删除旧的 journal_lines
        await db.execute(
            delete(JournalLine).where(JournalLine.entry_id == entry.id)
        )
        # 清除 ORM 缓存中的旧 lines
        entry.lines.clear()

        # Step 2b: 按 entry_type 重新生成 lines
        new_lines = await _rebuild_lines(db, entry, body)

        # Step 2c: 校验借贷平衡
        _check_balance(new_lines)

        # Step 2d: 关联新 lines
        for line in new_lines:
            line.entry_id = entry.id
            db.add(line)
        entry.lines = new_lines

    await db.flush()
    await db.refresh(entry)
    return entry


async def delete_entry(db: AsyncSession, entry: JournalEntry) -> None:
    """删除分录（级联删除 lines）"""
    await db.delete(entry)
    await db.flush()


# ─────────────────────── 分录类型转换 ───────────────────────

ALLOWED_CONVERSIONS: dict[str, set[str]] = {
    "expense": {"asset_purchase", "transfer"},
    "asset_purchase": {"expense"},
    "income": {"repay"},
    "transfer": {"expense", "income"},
}


def _extract_amount_from_lines(lines: list[JournalLine]) -> Decimal:
    """从借贷行中提取主金额（取借方总额）"""
    return sum(Decimal(str(l.debit_amount)) for l in lines)


def _extract_account_ids_from_lines(
    lines: list[JournalLine],
) -> dict[str, str]:
    """从借贷行中提取科目 ID 映射，返回 {debit_account_id, credit_account_id}"""
    debit_ids = [l.account_id for l in lines if Decimal(str(l.debit_amount)) > 0]
    credit_ids = [l.account_id for l in lines if Decimal(str(l.credit_amount)) > 0]
    result = {}
    if debit_ids:
        result["debit_account_id"] = debit_ids[0]
    if credit_ids:
        result["credit_account_id"] = credit_ids[0]
    return result


async def convert_entry_type(
    db: AsyncSession,
    entry_id: str,
    user_id: str,
    body,
) -> JournalEntry:
    """转换分录类型。

    1. 校验权限和转换路径合法性
    2. 删除原借贷明细行
    3. 根据新类型重建借贷明细行
    4. 更新 entry_type
    """
    from app.services.book_service import user_has_book_access

    # 1. 获取分录
    entry = await get_entry_detail(db, entry_id)
    if not entry:
        raise EntryError("分录不存在", 404)

    # 权限校验
    if not await user_has_book_access(db, user_id, entry.book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")

    # 2. 校验转换路径
    allowed = ALLOWED_CONVERSIONS.get(entry.entry_type, set())
    if body.target_type not in allowed:
        raise EntryError(
            f"不支持从 {entry.entry_type} 转换为 {body.target_type}。"
            f"允许的目标类型: {', '.join(allowed) if allowed else '无'}"
        )

    # 3. 从旧 lines 中提取金额和科目
    amount = _extract_amount_from_lines(entry.lines)
    old_accounts = _extract_account_ids_from_lines(entry.lines)

    # 4. 删除原借贷明细行
    await db.execute(
        delete(JournalLine).where(JournalLine.entry_id == entry_id)
    )
    entry.lines.clear()

    # 5. 确定新的科目 ID
    category_id = body.category_account_id or old_accounts.get("debit_account_id")
    payment_id = body.payment_account_id or old_accounts.get("credit_account_id")

    # 6. 校验科目存在且可用
    if category_id:
        await _get_account(db, category_id, entry.book_id)
    if payment_id:
        await _get_account(db, payment_id, entry.book_id)

    # 7. 根据新类型重建借贷明细
    match body.target_type:
        case "expense":
            if not category_id or not payment_id:
                raise EntryError("转换为费用需要 category_account_id 和 payment_account_id")
            new_lines = _build_expense_lines(amount, category_id, payment_id)
        case "income":
            if not payment_id or not category_id:
                raise EntryError("转换为收入需要 category_account_id 和 payment_account_id")
            new_lines = _build_income_lines(amount, payment_id, category_id)
        case "transfer":
            # transfer 需要 from 和 to，使用 payment_id 作为 from，category_id 作为 to
            from_id = body.payment_account_id or old_accounts.get("credit_account_id")
            to_id = body.category_account_id or old_accounts.get("debit_account_id")
            if not from_id or not to_id:
                raise EntryError("转换为转账需要来源和目标科目")
            new_lines = _build_transfer_lines(amount, from_id, to_id)
        case "asset_purchase":
            asset_id = body.category_account_id or old_accounts.get("debit_account_id")
            pay_id = body.payment_account_id or old_accounts.get("credit_account_id")
            if not asset_id or not pay_id:
                raise EntryError("转换为资产购置需要 asset_account_id 和 payment_account_id")
            new_lines = _build_asset_purchase_lines(amount, asset_id, pay_id)
        case "borrow":
            pay_id = body.category_account_id or old_accounts.get("debit_account_id")
            liability_id = body.payment_account_id or old_accounts.get("credit_account_id")
            if not pay_id or not liability_id:
                raise EntryError("转换为借入需要 payment_account_id 和 liability_account_id")
            new_lines = _build_borrow_lines(amount, pay_id, liability_id)
        case "repay":
            liability_id = body.category_account_id or old_accounts.get("debit_account_id")
            pay_id = body.payment_account_id or old_accounts.get("credit_account_id")
            if not liability_id or not pay_id:
                raise EntryError("转换为还款需要 liability_account_id 和 payment_account_id")
            # 还款默认全部作为本金，利息为 0
            new_lines = _build_repay_lines(amount, Decimal("0"), liability_id, pay_id)
        case _:
            raise EntryError(f"不支持的目标类型: {body.target_type}")

    # 8. 校验借贷平衡
    _check_balance(new_lines)

    # 9. 关联新 lines
    for line in new_lines:
        line.entry_id = entry.id
        db.add(line)
    entry.lines = new_lines

    # 10. 更新 entry_type
    entry.entry_type = body.target_type

    await db.flush()
    await db.refresh(entry)
    return entry
