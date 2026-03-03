"""
报表服务：资产负债表 & 损益表 & 仪表盘 & 趋势 & 占比
从分录明细行（journal_lines）实时汇算。
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from dateutil.relativedelta import relativedelta

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine


async def _query_account_balances(
    db: AsyncSession,
    book_id: str,
    date_filter,
    type_filter=None,
) -> list:
    """
    通用查询：按科目汇总 debit/credit 合计。
    date_filter: 附加到 JournalEntry 的日期条件列表
    type_filter: 科目类型筛选（可选）
    """

    # 子查询：先聚合 journal_lines，避免复杂多表 outerjoin
    # 只选属于本 book 且符合日期条件的 entry 对应的 lines
    entry_conditions = [
        JournalEntry.book_id == book_id,
    ] + date_filter

    line_sub = (
        select(
            JournalLine.account_id,
            func.coalesce(func.sum(JournalLine.debit_amount), 0).label("total_debit"),
            func.coalesce(func.sum(JournalLine.credit_amount), 0).label("total_credit"),
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(*entry_conditions)
        .group_by(JournalLine.account_id)
        .subquery()
    )

    # 主查询：Account LEFT JOIN 子查询
    where_clauses = [
        Account.book_id == book_id,
        Account.is_active == True,
    ]
    if type_filter:
        where_clauses.append(Account.type.in_(type_filter))

    stmt = (
        select(
            Account.id,
            Account.code,
            Account.name,
            Account.type,
            Account.balance_direction,
            Account.parent_id,
            func.coalesce(line_sub.c.total_debit, 0).label("total_debit"),
            func.coalesce(line_sub.c.total_credit, 0).label("total_credit"),
        )
        .outerjoin(line_sub, line_sub.c.account_id == Account.id)
        .where(*where_clauses)
        .order_by(Account.type, Account.sort_order, Account.code)
    )

    result = await db.execute(stmt)
    return result.all()


async def get_balance_sheet(
    db: AsyncSession,
    book_id: str,
    as_of_date: date,
) -> dict:
    """
    资产负债表（截至指定日期）

    1. 遍历所有科目（含收入/费用用于计算本期损益）
    2. 构建树形结构，子科目余额向上汇总到父科目
    3. 合计只累加根科目，避免重复计数
    4. 本期损益 = 收入合计 - 费用合计
    5. 校验：资产合计 == 负债合计 + 净资产合计
    """

    next_day = datetime(as_of_date.year, as_of_date.month, as_of_date.day) + timedelta(days=1)
    date_filter = [JournalEntry.entry_date < next_day]
    rows = await _query_account_balances(db, book_id, date_filter)

    # 先构建所有科目的 item dict，按类型分桶
    items_by_id: dict[str, dict] = {}
    children_map: dict[str, list[str]] = {}  # parent_id -> [child_ids]

    for row in rows:
        total_debit = Decimal(str(row.total_debit))
        total_credit = Decimal(str(row.total_credit))

        if row.balance_direction == "debit":
            balance = total_debit - total_credit
        else:
            balance = total_credit - total_debit

        item = {
            "account_id": row.id,
            "account_code": row.code,
            "account_name": row.name,
            "account_type": row.type,
            "balance_direction": row.balance_direction,
            "parent_id": row.parent_id,
            "debit_total": float(total_debit),
            "credit_total": float(total_credit),
            "balance": float(balance),
            "_raw_debit_minus_credit": float(total_debit - total_credit),
            "_balance_dec": balance,
            "_raw_dc_dec": total_debit - total_credit,
        }
        items_by_id[row.id] = item

        if row.parent_id:
            children_map.setdefault(row.parent_id, []).append(row.id)

    # 自底向上汇总：如果父科目存在于当前结果集中，把子科目余额加到父科目
    def sum_up(account_id: str) -> tuple[Decimal, Decimal]:
        """返回 (balance, raw_debit_minus_credit) 的子树汇总（全程 Decimal）"""
        item = items_by_id[account_id]
        child_ids = children_map.get(account_id, [])
        if not child_ids:
            return item["_balance_dec"], item["_raw_dc_dec"]

        total_bal = Decimal("0")
        total_raw = Decimal("0")
        for cid in child_ids:
            if cid in items_by_id:
                cb, cr = sum_up(cid)
                total_bal += cb
                total_raw += cr

        item["balance"] = float(total_bal)
        item["_raw_debit_minus_credit"] = float(total_raw)
        item["_balance_dec"] = total_bal
        item["_raw_dc_dec"] = total_raw
        return total_bal, total_raw

    # 找出所有根节点（无父或父不在当前结果集中）并汇总
    root_ids = [
        aid for aid, item in items_by_id.items()
        if not item["parent_id"] or item["parent_id"] not in items_by_id
    ]
    for rid in root_ids:
        sum_up(rid)

    # 分类、只用根科目做合计
    assets = []
    liabilities = []
    equities = []
    income_total = Decimal("0")
    expense_total = Decimal("0")
    total_asset = Decimal("0")
    total_liability = Decimal("0")
    total_equity = Decimal("0")

    for item in items_by_id.values():
        # 清除内部字段
        raw_dc = item.pop("_raw_debit_minus_credit")
        raw_dc_dec = item.pop("_raw_dc_dec")
        bal_dec = item.pop("_balance_dec")
        is_root = item["account_id"] in root_ids

        if item["account_type"] == "asset":
            assets.append(item)
            if is_root:
                total_asset += raw_dc_dec
        elif item["account_type"] == "liability":
            liabilities.append(item)
            if is_root:
                total_liability += bal_dec
        elif item["account_type"] == "equity":
            equities.append(item)
            if is_root:
                total_equity += bal_dec
        elif item["account_type"] == "income":
            if is_root:
                income_total += bal_dec
        elif item["account_type"] == "expense":
            if is_root:
                expense_total += bal_dec

    # 按 code 排序
    assets.sort(key=lambda x: x["account_code"])
    liabilities.sort(key=lambda x: x["account_code"])
    equities.sort(key=lambda x: x["account_code"])

    net_income = income_total - expense_total
    adjusted_equity = total_equity + net_income
    is_balanced = abs(float(total_asset) - float(total_liability + adjusted_equity)) < 0.01

    return {
        "as_of_date": as_of_date.isoformat(),
        "assets": assets,
        "liabilities": liabilities,
        "equities": equities,
        "net_income": float(net_income),
        "total_asset": float(total_asset),
        "total_liability": float(total_liability),
        "total_equity": float(total_equity),
        "adjusted_equity": float(adjusted_equity),
        "is_balanced": is_balanced,
    }


async def get_income_statement(
    db: AsyncSession,
    book_id: str,
    start_date: date,
    end_date: date,
) -> dict:
    """
    损益表（指定时间段）

    1. 构建树形结构，子科目余额向上汇总到父科目
    2. 合计只累加根科目，避免重复计数
    3. 本期损益 = 收入 - 费用
    """

    end_next_day = datetime(end_date.year, end_date.month, end_date.day) + timedelta(days=1)
    date_filter = [
        JournalEntry.entry_date >= datetime(start_date.year, start_date.month, start_date.day),
        JournalEntry.entry_date < end_next_day,
    ]
    rows = await _query_account_balances(
        db, book_id, date_filter, type_filter=["income", "expense"]
    )

    items_by_id: dict[str, dict] = {}
    children_map: dict[str, list[str]] = {}

    for row in rows:
        total_debit = Decimal(str(row.total_debit))
        total_credit = Decimal(str(row.total_credit))

        if row.balance_direction == "debit":
            balance = total_debit - total_credit
        else:
            balance = total_credit - total_debit

        item = {
            "account_id": row.id,
            "account_code": row.code,
            "account_name": row.name,
            "account_type": row.type,
            "balance_direction": row.balance_direction,
            "parent_id": row.parent_id,
            "debit_total": float(total_debit),
            "credit_total": float(total_credit),
            "balance": float(balance),
        }
        items_by_id[row.id] = item

        if row.parent_id:
            children_map.setdefault(row.parent_id, []).append(row.id)

    def sum_up(account_id: str) -> float:
        item = items_by_id[account_id]
        child_ids = children_map.get(account_id, [])
        if not child_ids:
            return item["balance"]
        total = Decimal("0")
        for cid in child_ids:
            if cid in items_by_id:
                total += Decimal(str(sum_up(cid)))
        item["balance"] = float(total)
        return item["balance"]

    root_ids = [
        aid for aid, item in items_by_id.items()
        if not item["parent_id"] or item["parent_id"] not in items_by_id
    ]
    for rid in root_ids:
        sum_up(rid)

    incomes = []
    expenses = []
    total_income = Decimal("0")
    total_expense = Decimal("0")

    for item in items_by_id.values():
        is_root = item["account_id"] in root_ids
        if item["account_type"] == "income":
            incomes.append(item)
            if is_root:
                total_income += Decimal(str(item["balance"]))
        elif item["account_type"] == "expense":
            expenses.append(item)
            if is_root:
                total_expense += Decimal(str(item["balance"]))

    incomes.sort(key=lambda x: x["account_code"])
    expenses.sort(key=lambda x: x["account_code"])

    net_income = total_income - total_expense

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "incomes": incomes,
        "expenses": expenses,
        "total_income": float(total_income),
        "total_expense": float(total_expense),
        "net_income": float(net_income),
    }


async def get_dashboard(
    db: AsyncSession,
    book_id: str,
) -> dict:
    """
    仪表盘聚合数据：净资产、本月收入/费用/损益、较上月变化、近 5 条分录
    """
    today_ = date.today()

    # 本月范围
    month_start = today_.replace(day=1)
    month_end = (month_start + relativedelta(months=1)) - timedelta(days=1)

    # 上月末
    prev_month_end = month_start - timedelta(days=1)

    # 并行算三张表
    bs = await get_balance_sheet(db, book_id, today_)
    prev_bs = await get_balance_sheet(db, book_id, prev_month_end)
    income_stmt = await get_income_statement(db, book_id, month_start, month_end)

    # 近 30 条分录（仅展示，不支持点击详情）
    from sqlalchemy.orm import selectinload
    from app.models.journal import JournalEntry as JE, JournalLine as JL
    stmt = (
        select(JE)
        .where(JE.book_id == book_id)
        .options(selectinload(JE.lines).selectinload(JL.account))
        .order_by(JE.entry_date.desc())
        .limit(30)
    )
    result = await db.execute(stmt)
    entries = result.scalars().all()

    def _calc_impact(entry) -> float:
        asset_delta = 0.0
        liability_delta = 0.0
        for line in entry.lines:
            acct = line.account
            if not acct:
                continue
            d = float(line.debit_amount or 0)
            c = float(line.credit_amount or 0)
            if acct.type == "asset":
                asset_delta += d - c
            elif acct.type == "liability":
                liability_delta += c - d
        return round(asset_delta - liability_delta, 2)

    recent_entries = [
        {
            "id": e.id,
            "book_id": e.book_id,
            "user_id": e.user_id,
            "entry_date": e.entry_date.isoformat() if e.entry_date else None,
            "entry_type": e.entry_type,
            "description": e.description,
            "note": e.note,
            "is_balanced": e.is_balanced,
            "source": e.source,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "updated_at": e.updated_at.isoformat() if e.updated_at else None,
            "net_worth_impact": _calc_impact(e),
        }
        for e in entries
    ]

    net_asset = bs["adjusted_equity"]
    prev_net_asset = prev_bs["adjusted_equity"]
    net_asset_change = net_asset - prev_net_asset

    return {
        "net_asset": net_asset,
        "prev_net_asset": prev_net_asset,
        "net_asset_change": net_asset_change,
        "total_asset": bs["total_asset"],
        "total_liability": bs["total_liability"],
        "month_income": income_stmt["total_income"],
        "month_expense": income_stmt["total_expense"],
        "month_net_income": income_stmt["net_income"],
        "recent_entries": recent_entries,
    }


async def get_net_worth_trend(
    db: AsyncSession,
    book_id: str,
    months: int = 12,
) -> list:
    """
    近 N 个月每月末的净资产趋势数据
    """
    today_ = date.today()
    points = []

    for i in range(months - 1, -1, -1):
        # 往前推 i 个月的月末
        ref = today_ - relativedelta(months=i)
        if i == 0:
            # 当前月用今天
            as_of = today_
        else:
            # 该月最后一天
            next_month = ref.replace(day=1) + relativedelta(months=1)
            as_of = next_month - timedelta(days=1)

        bs = await get_balance_sheet(db, book_id, as_of)
        points.append({
            "date": as_of.isoformat(),
            "label": as_of.strftime("%Y-%m"),
            "net_asset": bs["adjusted_equity"],
            "total_asset": bs["total_asset"],
            "total_liability": bs["total_liability"],
        })

    return points


async def get_expense_breakdown(
    db: AsyncSession,
    book_id: str,
    start_date: date,
    end_date: date,
) -> list:
    """
    费用分类占比：时间段内每个费用科目的金额和百分比
    """
    is_data = await get_income_statement(db, book_id, start_date, end_date)
    total = is_data["total_expense"]
    items = []
    for exp in is_data["expenses"]:
        bal = exp["balance"]
        if abs(bal) < 0.005:
            continue
        items.append({
            "account_id": exp["account_id"],
            "account_code": exp["account_code"],
            "account_name": exp["account_name"],
            "amount": bal,
            "percentage": round(bal / total * 100, 1) if total != 0 else 0,
        })
    items.sort(key=lambda x: x["amount"], reverse=True)
    return items


async def get_asset_allocation(
    db: AsyncSession,
    book_id: str,
) -> list:
    """
    资产配置占比：各资产科目当前余额的占比
    """
    bs = await get_balance_sheet(db, book_id, date.today())
    total = bs["total_asset"]
    items = []
    for a in bs["assets"]:
        bal = a["balance"]
        if abs(bal) < 0.005:
            continue
        items.append({
            "account_id": a["account_id"],
            "account_code": a["account_code"],
            "account_name": a["account_name"],
            "amount": bal,
            "percentage": round(bal / total * 100, 1) if total != 0 else 0,
        })
    items.sort(key=lambda x: x["amount"], reverse=True)
    return items
