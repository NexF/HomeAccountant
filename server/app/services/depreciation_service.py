"""折旧计算引擎 — 按月/按日直线法、处置"""

from datetime import date
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.asset import FixedAsset
from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine


class AssetError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


# ─────────────────────── helpers ───────────────────────


async def _get_account_by_code(
    db: AsyncSession, book_id: str, code: str
) -> Account | None:
    """根据科目代码查找科目"""
    result = await db.execute(
        select(Account).where(
            Account.book_id == book_id,
            Account.code == code,
            Account.is_active == True,
        )
    )
    return result.scalar_one_or_none()


async def _get_account(db: AsyncSession, account_id: str) -> Account:
    result = await db.execute(select(Account).where(Account.id == account_id))
    acc = result.scalar_one_or_none()
    if not acc:
        raise AssetError(f"科目不存在: {account_id}", 404)
    return acc


# ─────────────────────── 折旧计算 ───────────────────────


def calculate_period_depreciation(asset: FixedAsset) -> float:
    """
    计算每期折旧额（直线法）
    - monthly: (原值 × (1 - 残值率)) / 使用寿命月数
    - daily:   (原值 × (1 - 残值率)) / (使用寿命月数 × 30)
    """
    if asset.depreciation_method == "none":
        return 0.0
    cost = Decimal(str(asset.original_cost))
    rate = Decimal(str(asset.residual_rate)) / Decimal("100")
    depreciable = cost * (1 - rate)

    granularity = getattr(asset, "depreciation_granularity", "monthly")
    if granularity == "daily":
        total_days = asset.useful_life_months * 30
        if total_days <= 0:
            return 0.0
        return float(round(depreciable / total_days, 2))

    if asset.useful_life_months <= 0:
        return 0.0
    return float(round(depreciable / asset.useful_life_months, 2))


def can_depreciate(asset: FixedAsset) -> bool:
    """判断资产是否可以继续折旧"""
    if asset.status != "active":
        return False
    if asset.depreciation_method == "none":
        return False
    cost = Decimal(str(asset.original_cost))
    rate = Decimal(str(asset.residual_rate)) / Decimal("100")
    max_dep = float(cost * (1 - rate))
    return float(asset.accumulated_depreciation) < max_dep


def get_max_depreciation(asset: FixedAsset) -> float:
    """可折旧总额"""
    cost = Decimal(str(asset.original_cost))
    rate = Decimal(str(asset.residual_rate)) / Decimal("100")
    return float(cost * (1 - rate))


# ─────────────────────── 计提折旧 ───────────────────────


async def depreciate_one_period(
    db: AsyncSession,
    asset: FixedAsset,
    period_label: str,
    user_id: str,
) -> JournalEntry:
    """
    为指定资产计提一期折旧
    1. 校验资产可折旧
    2. 计算折旧额（最后一期可能不足整期）
    3. 创建分录：借 折旧费用(5014)，贷 累计折旧(1502)
    4. 更新 accumulated_depreciation
    """
    if not can_depreciate(asset):
        raise AssetError("该资产无法继续折旧（已达上限或已处置或折旧方式为 none）")

    # 检查是否已有该期折旧分录（防重复）
    existing = await db.execute(
        select(JournalEntry).where(
            JournalEntry.book_id == asset.book_id,
            JournalEntry.entry_type == "depreciation",
            JournalEntry.description.contains(asset.id),
            JournalEntry.description.contains(period_label),
        )
    )
    if existing.scalar_one_or_none():
        raise AssetError(f"该资产在 {period_label} 已计提过折旧")

    # 计算折旧额（最后一期不超过上限）
    period_dep = calculate_period_depreciation(asset)
    max_dep = get_max_depreciation(asset)
    remaining = max_dep - float(asset.accumulated_depreciation)
    actual_dep = min(period_dep, remaining)
    if actual_dep <= 0:
        raise AssetError("折旧额为 0，无法计提")

    actual_dep_decimal = Decimal(str(actual_dep))

    # 查找折旧费用科目(5014)和累计折旧科目(1502)
    dep_expense_acct = await _get_account_by_code(db, asset.book_id, "5014")
    acc_dep_acct = await _get_account_by_code(db, asset.book_id, "1502")
    if not dep_expense_acct or not acc_dep_acct:
        raise AssetError("找不到折旧费用科目(5014)或累计折旧科目(1502)")

    # 创建分录
    entry = JournalEntry(
        book_id=asset.book_id,
        user_id=user_id,
        entry_date=date.today(),
        entry_type="depreciation",
        description=f"折旧 - {asset.name} [{asset.id}] {period_label}",
    )
    line_debit = JournalLine(
        account_id=dep_expense_acct.id,
        debit_amount=actual_dep_decimal,
        credit_amount=Decimal("0"),
        description=f"{asset.name} 折旧",
    )
    line_credit = JournalLine(
        account_id=acc_dep_acct.id,
        debit_amount=Decimal("0"),
        credit_amount=actual_dep_decimal,
        description=f"{asset.name} 累计折旧",
    )
    entry.lines = [line_debit, line_credit]
    db.add(entry)

    # 更新资产累计折旧
    asset.accumulated_depreciation = float(
        Decimal(str(asset.accumulated_depreciation)) + actual_dep_decimal
    )

    await db.flush()
    await db.refresh(entry)
    return entry


async def depreciate_all_active(
    db: AsyncSession,
    book_id: str,
    period_label: str,
    granularity: str,
    user_id: str,
) -> list[JournalEntry]:
    """
    为账本下所有指定粒度的活跃资产批量计提折旧
    """
    result = await db.execute(
        select(FixedAsset).where(
            FixedAsset.book_id == book_id,
            FixedAsset.status == "active",
            FixedAsset.depreciation_method == "straight_line",
        )
    )
    assets = list(result.scalars().all())

    entries = []
    for asset in assets:
        asset_gran = getattr(asset, "depreciation_granularity", "monthly")
        if asset_gran != granularity:
            continue
        if not can_depreciate(asset):
            continue
        try:
            entry = await depreciate_one_period(db, asset, period_label, user_id)
            entries.append(entry)
        except AssetError:
            continue

    return entries


# ─────────────────────── 处置资产 ───────────────────────


async def dispose_asset(
    db: AsyncSession,
    asset: FixedAsset,
    disposal_income: float,
    disposal_date: date,
    income_account_id: str,
    user_id: str,
) -> JournalEntry:
    """
    处置资产
    1. 计算处置损益 = 处置收入 - 账面净值(原值 - 累计折旧)
    2. 生成处置分录
    3. 更新资产状态为 disposed
    """
    if asset.status == "disposed":
        raise AssetError("该资产已处置")

    net_book_value = Decimal(str(asset.original_cost)) - Decimal(
        str(asset.accumulated_depreciation)
    )
    disposal_income_d = Decimal(str(disposal_income))
    gain_loss = disposal_income_d - net_book_value

    income_acct = await _get_account(db, income_account_id)

    # 查找必要科目
    fixed_asset_acct_id = asset.account_id
    acc_dep_acct = await _get_account_by_code(db, asset.book_id, "1502")
    if not acc_dep_acct:
        raise AssetError("找不到累计折旧科目(1502)")

    entry = JournalEntry(
        book_id=asset.book_id,
        user_id=user_id,
        entry_date=disposal_date,
        entry_type="asset_dispose",
        description=f"处置资产 - {asset.name}",
    )

    lines = []
    accumulated = Decimal(str(asset.accumulated_depreciation))
    original_cost = Decimal(str(asset.original_cost))

    # 借方
    if disposal_income_d > 0:
        lines.append(
            JournalLine(
                account_id=income_acct.id,
                debit_amount=disposal_income_d,
                credit_amount=Decimal("0"),
                description="处置收入",
            )
        )
    if accumulated > 0:
        lines.append(
            JournalLine(
                account_id=acc_dep_acct.id,
                debit_amount=accumulated,
                credit_amount=Decimal("0"),
                description="累计折旧转出",
            )
        )

    # 贷方：固定资产原值
    lines.append(
        JournalLine(
            account_id=fixed_asset_acct_id,
            debit_amount=Decimal("0"),
            credit_amount=original_cost,
            description="固定资产冲销",
        )
    )

    # 处置损益
    if gain_loss > 0:
        # 有收益 → 贷 资产处置收益(4005 其他收入)
        gain_acct = await _get_account_by_code(db, asset.book_id, "4005")
        if gain_acct:
            lines.append(
                JournalLine(
                    account_id=gain_acct.id,
                    debit_amount=Decimal("0"),
                    credit_amount=gain_loss,
                    description="资产处置收益",
                )
            )
    elif gain_loss < 0:
        # 有损失 → 借 资产处置损失(5099 其他费用)
        loss_acct = await _get_account_by_code(db, asset.book_id, "5099")
        if loss_acct:
            lines.append(
                JournalLine(
                    account_id=loss_acct.id,
                    debit_amount=abs(gain_loss),
                    credit_amount=Decimal("0"),
                    description="资产处置损失",
                )
            )

    entry.lines = lines
    db.add(entry)

    # 更新资产状态
    asset.status = "disposed"

    await db.flush()
    await db.refresh(entry)
    return entry


# ─────────────────────── 查询 ───────────────────────


async def get_asset_with_account(
    db: AsyncSession, asset_id: str
) -> FixedAsset | None:
    """获取资产（含关联科目信息）"""
    result = await db.execute(
        select(FixedAsset)
        .options(selectinload(FixedAsset.account))
        .where(FixedAsset.id == asset_id)
    )
    return result.scalar_one_or_none()


async def get_depreciation_history(
    db: AsyncSession, asset_id: str
) -> list[dict]:
    """获取折旧历史（从分录表中查询 depreciation 类型且包含 asset_id 的记录）"""
    result = await db.execute(
        select(JournalEntry)
        .options(selectinload(JournalEntry.lines))
        .where(
            JournalEntry.entry_type == "depreciation",
            JournalEntry.description.contains(asset_id),
        )
        .order_by(JournalEntry.entry_date.desc())
    )
    entries = list(result.scalars().all())

    history = []
    # 计算累计值 — 按时间正序
    entries_asc = sorted(entries, key=lambda e: e.entry_date)
    running_accumulated = Decimal("0")

    for entry in entries_asc:
        # 从 description 中提取 period_label
        desc = entry.description or ""
        period = desc.rsplit(" ", 1)[-1] if " " in desc else str(entry.entry_date)

        # 折旧额 = 该分录中折旧费用科目的借方金额
        dep_amount = Decimal("0")
        for line in entry.lines:
            if line.debit_amount > 0:
                dep_amount = Decimal(str(line.debit_amount))
                break

        running_accumulated += dep_amount

        history.append({
            "period": period,
            "amount": float(dep_amount),
            "accumulated": float(running_accumulated),
            "net_value": 0.0,  # 需要在调用方补充
            "entry_id": entry.id,
        })

    return history
