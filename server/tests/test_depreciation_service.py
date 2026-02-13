"""折旧计算引擎 — 单元/集成测试

覆盖 TECH_SPEC 9.1 测试要点：
- 月度直线法折旧
- 每日直线法折旧
- 折旧达上限后停止
- 折旧方式 none 不折旧
- 处置资产（收益/损失）
- 同一期不重复折旧
- 月度任务不处理 daily 资产
- 每日任务不处理 monthly 资产
"""

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import FixedAsset
from app.models.account import Account
from app.models.journal import JournalEntry, JournalLine
from app.services.depreciation_service import (
    calculate_period_depreciation,
    can_depreciate,
    get_max_depreciation,
    depreciate_one_period,
    depreciate_all_active,
    dispose_asset,
    get_depreciation_history,
    AssetError,
)

from tests.conftest import TestSessionLocal


# ═══════════════════════════════════════════
# 纯计算测试（无需数据库）
# ═══════════════════════════════════════════


class TestCalculations:
    """折旧计算公式验证"""

    def _make_asset(self, **overrides):
        """用 SimpleNamespace 模拟资产对象，绕过 SQLAlchemy instrumentation"""
        defaults = dict(
            id=str(uuid.uuid4()),
            original_cost=8000.0,
            residual_rate=5.0,
            useful_life_months=36,
            depreciation_method="straight_line",
            depreciation_granularity="monthly",
            accumulated_depreciation=0,
            status="active",
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_monthly_straight_line(self):
        """月度直线法：原值 8000，残值率 5%，36 月 → 月折旧 ≈ 211.11"""
        asset = self._make_asset()
        dep = calculate_period_depreciation(asset)
        assert dep == pytest.approx(211.11, abs=0.01)

    def test_daily_straight_line(self):
        """每日直线法：原值 8000，残值率 5%，36 月 → 日折旧 ≈ 7.04（1080 天）"""
        asset = self._make_asset(depreciation_granularity="daily")
        dep = calculate_period_depreciation(asset)
        assert dep == pytest.approx(7.04, abs=0.01)

    def test_max_depreciation(self):
        """可折旧总额 = 8000 × 0.95 = 7600"""
        asset = self._make_asset()
        assert get_max_depreciation(asset) == pytest.approx(7600.0, abs=0.01)

    def test_depreciation_method_none(self):
        """折旧方式 none → 折旧额 = 0"""
        asset = self._make_asset(depreciation_method="none")
        assert calculate_period_depreciation(asset) == 0.0

    def test_can_depreciate_active(self):
        """活跃 + 直线法 + 未满 → 可折旧"""
        asset = self._make_asset()
        assert can_depreciate(asset) is True

    def test_cannot_depreciate_disposed(self):
        """已处置 → 不可折旧"""
        asset = self._make_asset(status="disposed")
        assert can_depreciate(asset) is False

    def test_cannot_depreciate_none_method(self):
        """折旧方式 none → 不可折旧"""
        asset = self._make_asset(depreciation_method="none")
        assert can_depreciate(asset) is False

    def test_cannot_depreciate_fully_depreciated(self):
        """累计折旧已达上限 → 不可折旧"""
        asset = self._make_asset(accumulated_depreciation=7600.0)
        assert can_depreciate(asset) is False

    def test_zero_useful_life(self):
        """使用寿命 0 → 折旧额 0"""
        asset = self._make_asset(useful_life_months=0)
        assert calculate_period_depreciation(asset) == 0.0

    def test_residual_rate_100(self):
        """残值率 100% → 可折旧额 0 → 不可折旧"""
        asset = self._make_asset(residual_rate=100.0)
        assert calculate_period_depreciation(asset) == 0.0
        assert get_max_depreciation(asset) == 0.0


# ═══════════════════════════════════════════
# 集成测试（需要数据库）
# ═══════════════════════════════════════════


class TestDepreciateOnePeriod:
    """计提一期折旧（数据库集成）"""

    @pytest.mark.asyncio
    async def test_depreciate_creates_entry(self, sample_asset, test_user):
        """正常折旧：创建分录 + 更新累计折旧"""
        async with TestSessionLocal() as db:
            # 重新加载 asset（在当前 session 中）
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            entry = await depreciate_one_period(db, asset, "2025-01", test_user.id)
            await db.commit()

            assert entry is not None
            assert entry.entry_type == "depreciation"
            assert "2025-01" in entry.description
            assert asset.id in entry.description

            # 检查累计折旧更新
            assert float(asset.accumulated_depreciation) == pytest.approx(211.11, abs=0.01)

            # 检查分录行
            await db.refresh(entry)
            lines_result = await db.execute(
                select(JournalLine).where(JournalLine.entry_id == entry.id)
            )
            lines = list(lines_result.scalars().all())
            assert len(lines) == 2

            debit_line = next(l for l in lines if float(l.debit_amount) > 0)
            credit_line = next(l for l in lines if float(l.credit_amount) > 0)
            assert float(debit_line.debit_amount) == pytest.approx(211.11, abs=0.01)
            assert float(credit_line.credit_amount) == pytest.approx(211.11, abs=0.01)

    @pytest.mark.asyncio
    async def test_no_duplicate_depreciation(self, sample_asset, test_user):
        """同一期不重复折旧"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            await depreciate_one_period(db, asset, "2025-01", test_user.id)
            await db.commit()

            # 第二次应抛异常
            async with TestSessionLocal() as db2:
                result2 = await db2.execute(
                    select(FixedAsset).where(FixedAsset.id == sample_asset.id)
                )
                asset2 = result2.scalar_one()
                with pytest.raises(AssetError, match="已计提过折旧"):
                    await depreciate_one_period(db2, asset2, "2025-01", test_user.id)

    @pytest.mark.asyncio
    async def test_last_period_partial(self, sample_asset, test_user):
        """最后一期不足整期的折旧额：min(period_dep, remaining)"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            # 设置累计折旧接近上限（7600 - 100 = 7500）
            asset.accumulated_depreciation = 7500.0
            await db.flush()

            entry = await depreciate_one_period(db, asset, "2025-01", test_user.id)
            await db.commit()

            # 实际折旧额应为 100（而非 211.11）
            lines_result = await db.execute(
                select(JournalLine).where(JournalLine.entry_id == entry.id)
            )
            lines = list(lines_result.scalars().all())
            debit_line = next(l for l in lines if float(l.debit_amount) > 0)
            assert float(debit_line.debit_amount) == pytest.approx(100.0, abs=0.01)

            # 累计折旧 = 7600
            assert float(asset.accumulated_depreciation) == pytest.approx(7600.0, abs=0.01)

    @pytest.mark.asyncio
    async def test_fully_depreciated_cannot_continue(self, sample_asset, test_user):
        """折旧达上限后不再折旧"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()
            asset.accumulated_depreciation = 7600.0
            await db.flush()

            with pytest.raises(AssetError, match="无法继续折旧"):
                await depreciate_one_period(db, asset, "2025-01", test_user.id)

    @pytest.mark.asyncio
    async def test_daily_depreciation(self, daily_asset, test_user):
        """每日折旧计提"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == daily_asset.id)
            )
            asset = result.scalar_one()

            entry = await depreciate_one_period(db, asset, "2025-01-15", test_user.id)
            await db.commit()

            assert entry is not None
            assert float(asset.accumulated_depreciation) == pytest.approx(7.04, abs=0.01)


class TestDepreciateAllActive:
    """批量折旧测试"""

    @pytest.mark.asyncio
    async def test_monthly_skips_daily(self, sample_asset, daily_asset, test_user):
        """月度任务不处理 daily 资产"""
        async with TestSessionLocal() as db:
            entries = await depreciate_all_active(
                db, sample_asset.book_id, "2025-01", "monthly", test_user.id
            )
            await db.commit()

            # 只折旧了 monthly 资产（sample_asset），不包含 daily_asset
            assert len(entries) == 1
            assert sample_asset.id in entries[0].description

    @pytest.mark.asyncio
    async def test_daily_skips_monthly(self, sample_asset, daily_asset, test_user):
        """每日任务不处理 monthly 资产"""
        async with TestSessionLocal() as db:
            entries = await depreciate_all_active(
                db, daily_asset.book_id, "2025-01-15", "daily", test_user.id
            )
            await db.commit()

            assert len(entries) == 1
            assert daily_asset.id in entries[0].description


class TestDisposeAsset:
    """资产处置测试"""

    @pytest.mark.asyncio
    async def test_dispose_with_gain(self, sample_asset, income_account, test_user):
        """处置有收益：处置收入 > 账面净值"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            # 累计折旧 2000 → 净值 6000 → 处置收入 7000 → 收益 1000
            asset.accumulated_depreciation = 2000.0
            await db.flush()

            entry = await dispose_asset(
                db, asset, 7000.0, date(2026, 1, 1),
                income_account.id, test_user.id,
            )
            await db.commit()

            assert asset.status == "disposed"
            assert entry is not None

            # 检查分录行
            lines_result = await db.execute(
                select(JournalLine).where(JournalLine.entry_id == entry.id)
            )
            lines = list(lines_result.scalars().all())

            total_debit = sum(float(l.debit_amount) for l in lines)
            total_credit = sum(float(l.credit_amount) for l in lines)
            # 借贷应平衡
            assert total_debit == pytest.approx(total_credit, abs=0.01)

    @pytest.mark.asyncio
    async def test_dispose_with_loss(self, sample_asset, income_account, test_user):
        """处置有损失：处置收入 < 账面净值"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            # 累计折旧 2000 → 净值 6000 → 处置收入 5000 → 损失 1000
            asset.accumulated_depreciation = 2000.0
            await db.flush()

            entry = await dispose_asset(
                db, asset, 5000.0, date(2026, 1, 1),
                income_account.id, test_user.id,
            )
            await db.commit()

            assert asset.status == "disposed"

            lines_result = await db.execute(
                select(JournalLine).where(JournalLine.entry_id == entry.id)
            )
            lines = list(lines_result.scalars().all())

            total_debit = sum(float(l.debit_amount) for l in lines)
            total_credit = sum(float(l.credit_amount) for l in lines)
            assert total_debit == pytest.approx(total_credit, abs=0.01)

    @pytest.mark.asyncio
    async def test_dispose_already_disposed(self, sample_asset, income_account, test_user):
        """已处置资产不能再处置"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()
            asset.status = "disposed"
            await db.flush()

            with pytest.raises(AssetError, match="已处置"):
                await dispose_asset(
                    db, asset, 1000.0, date(2026, 1, 1),
                    income_account.id, test_user.id,
                )


class TestDepreciationHistory:
    """折旧历史查询"""

    @pytest.mark.asyncio
    async def test_history_returns_records(self, sample_asset, test_user):
        """折旧后可查到历史记录"""
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()

            await depreciate_one_period(db, asset, "2025-01", test_user.id)
            await depreciate_one_period(db, asset, "2025-02", test_user.id)
            await db.commit()

            history = await get_depreciation_history(db, sample_asset.id)
            assert len(history) == 2
            # 累计值递增
            assert history[1]["accumulated"] > history[0]["accumulated"]

    @pytest.mark.asyncio
    async def test_history_empty_for_new_asset(self, sample_asset):
        """新资产无折旧历史"""
        async with TestSessionLocal() as db:
            history = await get_depreciation_history(db, sample_asset.id)
            assert history == []
