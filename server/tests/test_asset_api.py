"""固定资产 API 端点 — 功能测试

覆盖全部 8 个 API 端点的正常与异常路径。
"""

from datetime import date

import pytest
from httpx import AsyncClient

from app.models.asset import FixedAsset
from app.models.account import Account
from app.models.book import Book
from app.models.user import User


# ═══════════════════════════════════════════
# 资产 CRUD
# ═══════════════════════════════════════════


class TestCreateAsset:

    @pytest.mark.asyncio
    async def test_create_monthly_asset(
        self, client: AsyncClient, auth_headers, test_book: Book, fixed_asset_account: Account
    ):
        """POST /books/{book_id}/assets — 新建月度折旧资产"""
        payload = {
            "name": "办公桌椅",
            "account_id": fixed_asset_account.id,
            "purchase_date": "2025-06-01",
            "original_cost": 5000,
            "residual_rate": 5,
            "useful_life_months": 60,
            "depreciation_method": "straight_line",
            "depreciation_granularity": "monthly",
        }
        resp = await client.post(
            f"/books/{test_book.id}/assets", json=payload, headers=auth_headers
        )
        assert resp.status_code == 201
        data = resp.json()

        assert data["name"] == "办公桌椅"
        assert data["original_cost"] == 5000
        assert data["depreciation_granularity"] == "monthly"
        assert data["status"] == "active"
        assert data["accumulated_depreciation"] == 0
        assert data["net_book_value"] == 5000
        # 月折旧 = 5000 * 0.95 / 60 ≈ 79.17
        assert data["period_depreciation"] == pytest.approx(79.17, abs=0.01)

    @pytest.mark.asyncio
    async def test_create_daily_asset(
        self, client: AsyncClient, auth_headers, test_book: Book, fixed_asset_account: Account
    ):
        """POST /books/{book_id}/assets — 新建每日折旧资产"""
        payload = {
            "name": "打印机",
            "account_id": fixed_asset_account.id,
            "purchase_date": "2025-01-01",
            "original_cost": 8000,
            "residual_rate": 5,
            "useful_life_months": 36,
            "depreciation_method": "straight_line",
            "depreciation_granularity": "daily",
        }
        resp = await client.post(
            f"/books/{test_book.id}/assets", json=payload, headers=auth_headers
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["depreciation_granularity"] == "daily"
        # 日折旧 = 8000 * 0.95 / (36*30) ≈ 7.04
        assert data["period_depreciation"] == pytest.approx(7.04, abs=0.01)

    @pytest.mark.asyncio
    async def test_create_no_depreciation(
        self, client: AsyncClient, auth_headers, test_book: Book, fixed_asset_account: Account
    ):
        """创建不折旧的资产"""
        payload = {
            "name": "土地",
            "account_id": fixed_asset_account.id,
            "purchase_date": "2025-01-01",
            "original_cost": 100000,
            "residual_rate": 0,
            "useful_life_months": 1,
            "depreciation_method": "none",
        }
        resp = await client.post(
            f"/books/{test_book.id}/assets", json=payload, headers=auth_headers
        )
        assert resp.status_code == 201
        assert resp.json()["period_depreciation"] == 0
        assert resp.json()["depreciation_method"] == "none"

    @pytest.mark.asyncio
    async def test_create_invalid_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """关联不存在的科目 → 404"""
        payload = {
            "name": "幽灵资产",
            "account_id": "non-existent-id",
            "purchase_date": "2025-01-01",
            "original_cost": 1000,
            "useful_life_months": 12,
        }
        resp = await client.post(
            f"/books/{test_book.id}/assets", json=payload, headers=auth_headers
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_invalid_book(
        self, client: AsyncClient, auth_headers, fixed_asset_account: Account
    ):
        """无权访问的账本 → 403"""
        payload = {
            "name": "test",
            "account_id": fixed_asset_account.id,
            "purchase_date": "2025-01-01",
            "original_cost": 1000,
            "useful_life_months": 12,
        }
        resp = await client.post(
            "/books/fake-book-id/assets", json=payload, headers=auth_headers
        )
        assert resp.status_code == 403


class TestListAssets:

    @pytest.mark.asyncio
    async def test_list_all(
        self, client: AsyncClient, auth_headers, test_book: Book, sample_asset: FixedAsset
    ):
        """GET /books/{book_id}/assets — 获取全部资产"""
        resp = await client.get(
            f"/books/{test_book.id}/assets", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert any(a["id"] == sample_asset.id for a in data)

    @pytest.mark.asyncio
    async def test_list_filter_status(
        self, client: AsyncClient, auth_headers, test_book: Book, sample_asset: FixedAsset
    ):
        """按状态筛选"""
        resp = await client.get(
            f"/books/{test_book.id}/assets?status=active", headers=auth_headers
        )
        assert resp.status_code == 200
        for asset in resp.json():
            assert asset["status"] == "active"

    @pytest.mark.asyncio
    async def test_list_filter_disposed(
        self, client: AsyncClient, auth_headers, test_book: Book, sample_asset: FixedAsset
    ):
        """筛选已处置 — 新创建的都是 active，所以 disposed 应为空"""
        resp = await client.get(
            f"/books/{test_book.id}/assets?status=disposed", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetAsset:

    @pytest.mark.asyncio
    async def test_get_by_id(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """GET /assets/{id} — 获取单个资产详情"""
        resp = await client.get(
            f"/assets/{sample_asset.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_asset.id
        assert data["name"] == "测试笔记本电脑"
        assert data["original_cost"] == 8000
        assert data["depreciation_granularity"] == "monthly"

    @pytest.mark.asyncio
    async def test_get_not_found(self, client: AsyncClient, auth_headers):
        """不存在的资产 → 404"""
        resp = await client.get("/assets/nonexistent-id", headers=auth_headers)
        assert resp.status_code == 404


class TestUpdateAsset:

    @pytest.mark.asyncio
    async def test_update_name(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """PUT /assets/{id} — 更新资产名称"""
        resp = await client.put(
            f"/assets/{sample_asset.id}",
            json={"name": "新笔记本电脑"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新笔记本电脑"

    @pytest.mark.asyncio
    async def test_update_granularity(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """更新折旧粒度"""
        resp = await client.put(
            f"/assets/{sample_asset.id}",
            json={"depreciation_granularity": "daily"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["depreciation_granularity"] == "daily"

    @pytest.mark.asyncio
    async def test_update_disposed_asset_fails(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """已处置资产不能修改 → 400"""
        from tests.conftest import TestSessionLocal
        from sqlalchemy import select

        async with TestSessionLocal() as db:
            result = await db.execute(
                select(FixedAsset).where(FixedAsset.id == sample_asset.id)
            )
            asset = result.scalar_one()
            asset.status = "disposed"
            await db.commit()

        resp = await client.put(
            f"/assets/{sample_asset.id}",
            json={"name": "不应修改"},
            headers=auth_headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════
# 折旧操作
# ═══════════════════════════════════════════


class TestDepreciateAPI:

    @pytest.mark.asyncio
    async def test_manual_depreciate(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """POST /assets/{id}/depreciate — 手动计提一期"""
        resp = await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-01",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "entry_id" in data
        assert data["asset"]["accumulated_depreciation"] == pytest.approx(211.11, abs=0.01)

    @pytest.mark.asyncio
    async def test_depreciate_auto_period(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """不传 period 参数 → 自动根据粒度生成"""
        resp = await client.post(
            f"/assets/{sample_asset.id}/depreciate",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert "entry_id" in resp.json()

    @pytest.mark.asyncio
    async def test_depreciate_daily_asset(
        self, client: AsyncClient, auth_headers, daily_asset: FixedAsset
    ):
        """每日折旧资产的手动计提"""
        resp = await client.post(
            f"/assets/{daily_asset.id}/depreciate?period=2025-01-15",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["asset"]["accumulated_depreciation"] == pytest.approx(7.04, abs=0.01)

    @pytest.mark.asyncio
    async def test_duplicate_period_fails(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """同一期重复计提 → 失败"""
        await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-03",
            headers=auth_headers,
        )
        resp2 = await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-03",
            headers=auth_headers,
        )
        assert resp2.status_code == 400
        assert "已计提" in resp2.json()["detail"]

    @pytest.mark.asyncio
    async def test_depreciate_nonexistent(self, client: AsyncClient, auth_headers):
        """不存在的资产 → 404"""
        resp = await client.post(
            "/assets/nonexistent/depreciate?period=2025-01",
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ═══════════════════════════════════════════
# 资产处置
# ═══════════════════════════════════════════


class TestDisposeAPI:

    @pytest.mark.asyncio
    async def test_dispose_asset(
        self, client: AsyncClient, auth_headers,
        sample_asset: FixedAsset, income_account: Account,
    ):
        """POST /assets/{id}/dispose — 处置资产"""
        payload = {
            "disposal_income": 6000,
            "disposal_date": "2026-06-01",
            "income_account_id": income_account.id,
        }
        resp = await client.post(
            f"/assets/{sample_asset.id}/dispose",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["asset"]["status"] == "disposed"
        assert "entry_id" in data

    @pytest.mark.asyncio
    async def test_dispose_already_disposed(
        self, client: AsyncClient, auth_headers,
        sample_asset: FixedAsset, income_account: Account,
    ):
        """已处置资产再次处置 → 400"""
        payload = {
            "disposal_income": 6000,
            "disposal_date": "2026-06-01",
            "income_account_id": income_account.id,
        }
        # 第一次处置
        await client.post(
            f"/assets/{sample_asset.id}/dispose",
            json=payload,
            headers=auth_headers,
        )
        # 第二次处置
        resp = await client.post(
            f"/assets/{sample_asset.id}/dispose",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════
# 折旧历史 & 汇总
# ═══════════════════════════════════════════


class TestDepreciationHistory:

    @pytest.mark.asyncio
    async def test_get_history(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """GET /assets/{id}/depreciation-history"""
        # 先计提 2 期
        await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-01",
            headers=auth_headers,
        )
        await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-02",
            headers=auth_headers,
        )

        resp = await client.get(
            f"/assets/{sample_asset.id}/depreciation-history",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) == 2

        # 验证累计值递增
        assert history[1]["accumulated"] > history[0]["accumulated"]
        # 验证 net_value 递减
        assert history[1]["net_value"] < history[0]["net_value"]

    @pytest.mark.asyncio
    async def test_empty_history(
        self, client: AsyncClient, auth_headers, sample_asset: FixedAsset
    ):
        """新资产无折旧历史"""
        resp = await client.get(
            f"/assets/{sample_asset.id}/depreciation-history",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestAssetSummary:

    @pytest.mark.asyncio
    async def test_summary(
        self, client: AsyncClient, auth_headers,
        test_book: Book, sample_asset: FixedAsset,
    ):
        """GET /books/{book_id}/assets/summary"""
        resp = await client.get(
            f"/books/{test_book.id}/assets/summary",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["asset_count"] >= 1
        assert data["active_count"] >= 1
        assert data["total_original_cost"] >= 8000
        assert data["total_net_book_value"] == data["total_original_cost"] - data["total_accumulated_depreciation"]

    @pytest.mark.asyncio
    async def test_summary_after_depreciation(
        self, client: AsyncClient, auth_headers,
        test_book: Book, sample_asset: FixedAsset,
    ):
        """折旧后汇总数据更新"""
        # 计提 1 期
        await client.post(
            f"/assets/{sample_asset.id}/depreciate?period=2025-01",
            headers=auth_headers,
        )

        resp = await client.get(
            f"/books/{test_book.id}/assets/summary",
            headers=auth_headers,
        )
        data = resp.json()
        assert data["total_accumulated_depreciation"] == pytest.approx(211.11, abs=0.01)
        assert data["total_net_book_value"] == pytest.approx(
            data["total_original_cost"] - 211.11, abs=0.01
        )


# ═══════════════════════════════════════════
# 认证 & 权限
# ═══════════════════════════════════════════


class TestAuth:

    @pytest.mark.asyncio
    async def test_no_token_returns_401(self, client: AsyncClient, test_book: Book):
        """无 Token → 401"""
        resp = await client.get(f"/books/{test_book.id}/assets")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_token_returns_401(self, client: AsyncClient, test_book: Book):
        """无效 Token → 401"""
        resp = await client.get(
            f"/books/{test_book.id}/assets",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert resp.status_code == 401
