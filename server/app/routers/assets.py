"""固定资产 API 路由"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User
from app.models.asset import FixedAsset
from app.models.account import Account
from app.schemas.asset import (
    AssetCreate,
    AssetUpdate,
    AssetResponse,
    AssetDispose,
    AssetSummary,
    DepreciationRecord,
)
from app.services.depreciation_service import (
    calculate_period_depreciation,
    can_depreciate,
    get_max_depreciation,
    depreciate_one_period,
    dispose_asset,
    get_asset_with_account,
    get_depreciation_history,
    AssetError,
)
from app.services.book_service import user_has_book_access
from app.utils.deps import get_current_user

router = APIRouter(tags=["固定资产"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


def _to_response(asset: FixedAsset) -> AssetResponse:
    """将 ORM FixedAsset 转为响应模型"""
    period_dep = calculate_period_depreciation(asset)
    max_dep = get_max_depreciation(asset)
    net_value = float(asset.original_cost) - float(asset.accumulated_depreciation)
    dep_pct = (
        float(asset.accumulated_depreciation) / max_dep * 100 if max_dep > 0 else 0
    )

    # 计算剩余月数
    if period_dep > 0 and asset.depreciation_method != "none":
        remaining_amount = max_dep - float(asset.accumulated_depreciation)
        granularity = asset.depreciation_granularity or "monthly"
        if granularity == "daily":
            remaining_days = remaining_amount / period_dep if period_dep > 0 else 0
            remaining_months = int(remaining_days / 30)
        else:
            remaining_months = int(remaining_amount / period_dep) if period_dep > 0 else 0
    else:
        remaining_months = 0

    return AssetResponse(
        id=asset.id,
        book_id=asset.book_id,
        account_id=asset.account_id,
        account_name=asset.account.name if asset.account else "未知",
        name=asset.name,
        purchase_date=asset.purchase_date,
        original_cost=float(asset.original_cost),
        residual_rate=float(asset.residual_rate),
        useful_life_months=asset.useful_life_months,
        depreciation_method=asset.depreciation_method,
        depreciation_granularity=asset.depreciation_granularity or "monthly",
        accumulated_depreciation=float(asset.accumulated_depreciation),
        net_book_value=round(net_value, 2),
        period_depreciation=period_dep,
        remaining_months=remaining_months,
        depreciation_percentage=round(dep_pct, 1),
        status=asset.status,
        created_at=asset.created_at,
    )


# ─────────────────────── CRUD ───────────────────────


@router.get(
    "/books/{book_id}/assets",
    response_model=list[AssetResponse],
    summary="固定资产列表",
)
async def list_assets(
    book_id: str,
    status: str | None = Query(None, pattern=r"^(active|disposed)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_book(current_user.id, book_id, db)

    conditions = [FixedAsset.book_id == book_id]
    if status:
        conditions.append(FixedAsset.status == status)

    result = await db.execute(
        select(FixedAsset)
        .options(selectinload(FixedAsset.account))
        .where(*conditions)
        .order_by(FixedAsset.created_at.desc())
    )
    assets = list(result.scalars().all())
    return [_to_response(a) for a in assets]


@router.get(
    "/assets/{asset_id}",
    response_model=AssetResponse,
    summary="固定资产详情",
)
async def get_asset(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)
    return _to_response(asset)


@router.post(
    "/books/{book_id}/assets",
    response_model=AssetResponse,
    status_code=201,
    summary="新建固定资产",
)
async def create_asset(
    book_id: str,
    body: AssetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_book(current_user.id, book_id, db)

    # 校验科目归属
    acct = await db.execute(
        select(Account).where(
            Account.id == body.account_id,
            Account.book_id == book_id,
            Account.is_active == True,
        )
    )
    if not acct.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="关联科目不存在或不属于该账本")

    asset = FixedAsset(
        book_id=book_id,
        account_id=body.account_id,
        name=body.name,
        purchase_date=body.purchase_date,
        original_cost=body.original_cost,
        residual_rate=body.residual_rate,
        useful_life_months=body.useful_life_months,
        depreciation_method=body.depreciation_method,
        depreciation_granularity=body.depreciation_granularity,
    )

    db.add(asset)
    await db.flush()
    await db.refresh(asset)

    # 重新加载关联
    loaded = await get_asset_with_account(db, asset.id)
    return _to_response(loaded)


@router.put(
    "/assets/{asset_id}",
    response_model=AssetResponse,
    summary="更新固定资产",
)
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)

    if asset.status == "disposed":
        raise HTTPException(status_code=400, detail="已处置的资产不能修改")

    if body.name is not None:
        asset.name = body.name
    if body.residual_rate is not None:
        asset.residual_rate = body.residual_rate
    if body.useful_life_months is not None:
        asset.useful_life_months = body.useful_life_months
    if body.depreciation_method is not None:
        asset.depreciation_method = body.depreciation_method
    if body.depreciation_granularity is not None:
        asset.depreciation_granularity = body.depreciation_granularity

    await db.flush()
    loaded = await get_asset_with_account(db, asset.id)
    return _to_response(loaded)


@router.delete(
    "/assets/{asset_id}",
    summary="删除固定资产",
)
async def delete_asset(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)

    await db.delete(asset)
    await db.flush()
    return {"message": f"资产「{asset.name}」已删除"}


# ─────────────────────── 折旧操作 ───────────────────────


@router.post(
    "/assets/{asset_id}/depreciate",
    summary="手动触发折旧（计提一期）",
)
async def depreciate_asset(
    asset_id: str,
    period: str | None = Query(None, description="折旧期间标签，如 2026-02 或 2026-02-13"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)

    # 自动生成期间标签
    if not period:
        from datetime import date as dt_date

        today = dt_date.today()
        granularity = asset.depreciation_granularity or "monthly"
        if granularity == "daily":
            period = today.strftime("%Y-%m-%d")
        else:
            period = today.strftime("%Y-%m")

    try:
        entry = await depreciate_one_period(db, asset, period, current_user.id)
    except AssetError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    loaded = await get_asset_with_account(db, asset.id)
    return {
        "message": f"折旧成功，折旧额 {calculate_period_depreciation(asset)}",
        "entry_id": entry.id,
        "asset": _to_response(loaded),
    }


@router.post(
    "/assets/{asset_id}/dispose",
    summary="处置资产",
)
async def dispose(
    asset_id: str,
    body: AssetDispose,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)

    try:
        entry = await dispose_asset(
            db, asset,
            body.disposal_income,
            body.disposal_date,
            body.income_account_id,
            current_user.id,
        )
    except AssetError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    loaded = await get_asset_with_account(db, asset.id)
    return {
        "message": f"资产「{asset.name}」已处置",
        "entry_id": entry.id,
        "asset": _to_response(loaded),
    }


# ─────────────────────── 折旧历史 & 汇总 ───────────────────────


@router.get(
    "/assets/{asset_id}/depreciation-history",
    response_model=list[DepreciationRecord],
    summary="折旧历史",
)
async def get_dep_history(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await get_asset_with_account(db, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    await _check_book(current_user.id, asset.book_id, db)

    history = await get_depreciation_history(db, asset_id)
    original_cost = float(asset.original_cost)
    for record in history:
        record["net_value"] = round(original_cost - record["accumulated"], 2)
    return history


@router.get(
    "/books/{book_id}/assets/summary",
    response_model=AssetSummary,
    summary="资产汇总",
)
async def get_summary(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _check_book(current_user.id, book_id, db)

    result = await db.execute(
        select(FixedAsset).where(FixedAsset.book_id == book_id)
    )
    assets = list(result.scalars().all())

    total_cost = sum(float(a.original_cost) for a in assets)
    total_dep = sum(float(a.accumulated_depreciation) for a in assets)
    active_count = sum(1 for a in assets if a.status == "active")

    return AssetSummary(
        total_original_cost=round(total_cost, 2),
        total_accumulated_depreciation=round(total_dep, 2),
        total_net_book_value=round(total_cost - total_dep, 2),
        asset_count=len(assets),
        active_count=active_count,
    )
