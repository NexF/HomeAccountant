"""报表模块功能测试

覆盖端点：
- GET /books/{book_id}/balance-sheet
- GET /books/{book_id}/income-statement
- GET /books/{book_id}/dashboard
- GET /books/{book_id}/net-worth-trend
- GET /books/{book_id}/expense-breakdown
- GET /books/{book_id}/asset-allocation
"""

import pytest
from httpx import AsyncClient

from app.models.book import Book


async def _get_account_id(client, book_id, code, headers):
    resp = await client.get(f"/books/{book_id}/accounts", headers=headers)
    tree = resp.json()
    for group in tree.values():
        for acct in group:
            if acct["code"] == code:
                return acct["id"]
            for child in acct.get("children", []):
                if child["code"] == code:
                    return child["id"]
    return None


async def _create_expense(client, book_id, amount, headers):
    """辅助方法：创建一笔费用分录"""
    food_id = await _get_account_id(client, book_id, "5001", headers)
    cash_id = await _get_account_id(client, book_id, "1001", headers)
    return await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "expense",
            "entry_date": "2025-06-15",
            "amount": amount,
            "category_account_id": food_id,
            "payment_account_id": cash_id,
        },
        headers=headers,
    )


async def _create_income(client, book_id, amount, headers):
    """辅助方法：创建一笔收入分录"""
    salary_id = await _get_account_id(client, book_id, "4001", headers)
    bank_id = await _get_account_id(client, book_id, "1002", headers)
    return await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "income",
            "entry_date": "2025-06-01",
            "amount": amount,
            "category_account_id": salary_id,
            "payment_account_id": bank_id,
        },
        headers=headers,
    )


class TestBalanceSheet:

    @pytest.mark.asyncio
    async def test_balance_sheet_empty(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """空账本的资产负债表"""
        resp = await client.get(
            f"/books/{test_book.id}/balance-sheet", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "assets" in data
        assert "liabilities" in data
        assert "equities" in data
        assert "is_balanced" in data

    @pytest.mark.asyncio
    async def test_balance_sheet_after_entries(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """有分录后的资产负债表应平衡"""
        await _create_income(client, test_book.id, 10000, auth_headers)
        await _create_expense(client, test_book.id, 200, auth_headers)

        resp = await client.get(
            f"/books/{test_book.id}/balance-sheet", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_balanced"] is True
        assert data["total_asset"] > 0

    @pytest.mark.asyncio
    async def test_balance_sheet_with_date(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定截止日期"""
        resp = await client.get(
            f"/books/{test_book.id}/balance-sheet?date=2025-01-01",
            headers=auth_headers,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_balance_sheet_forbidden(self, client: AsyncClient, auth_headers):
        resp = await client.get(
            "/books/fake-id/balance-sheet", headers=auth_headers
        )
        assert resp.status_code == 403


class TestIncomeStatement:

    @pytest.mark.asyncio
    async def test_income_statement(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """损益表"""
        await _create_income(client, test_book.id, 10000, auth_headers)
        await _create_expense(client, test_book.id, 300, auth_headers)

        resp = await client.get(
            f"/books/{test_book.id}/income-statement?start=2025-06-01&end=2025-06-30",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_income"] == pytest.approx(10000)
        assert data["total_expense"] == pytest.approx(300)
        assert data["net_income"] == pytest.approx(9700)

    @pytest.mark.asyncio
    async def test_income_statement_missing_dates(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """缺少必填日期参数 → 422"""
        resp = await client.get(
            f"/books/{test_book.id}/income-statement",
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_income_statement_invalid_range(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """开始日期晚于结束日期 → 400"""
        resp = await client.get(
            f"/books/{test_book.id}/income-statement?start=2025-07-01&end=2025-06-01",
            headers=auth_headers,
        )
        assert resp.status_code == 400


class TestDashboard:

    @pytest.mark.asyncio
    async def test_dashboard(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """仪表盘"""
        resp = await client.get(
            f"/books/{test_book.id}/dashboard", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "net_asset" in data
        assert "month_income" in data
        assert "month_expense" in data
        assert "recent_entries" in data
        assert isinstance(data["recent_entries"], list)

    @pytest.mark.asyncio
    async def test_dashboard_with_data(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """有数据的仪表盘"""
        await _create_income(client, test_book.id, 8000, auth_headers)
        await _create_expense(client, test_book.id, 100, auth_headers)

        resp = await client.get(
            f"/books/{test_book.id}/dashboard", headers=auth_headers
        )
        data = resp.json()
        assert data["net_asset"] > 0
        assert len(data["recent_entries"]) >= 2


class TestNetWorthTrend:

    @pytest.mark.asyncio
    async def test_net_worth_trend(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """净资产趋势（默认 12 个月）"""
        resp = await client.get(
            f"/books/{test_book.id}/net-worth-trend", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) <= 12

    @pytest.mark.asyncio
    async def test_net_worth_trend_custom_months(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """自定义月数"""
        resp = await client.get(
            f"/books/{test_book.id}/net-worth-trend?months=3",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert len(resp.json()) <= 3


class TestExpenseBreakdown:

    @pytest.mark.asyncio
    async def test_expense_breakdown(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用分类占比"""
        await _create_expense(client, test_book.id, 500, auth_headers)

        resp = await client.get(
            f"/books/{test_book.id}/expense-breakdown?start=2025-06-01&end=2025-06-30",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "percentage" in data[0]
            total_pct = sum(item["percentage"] for item in data)
            assert total_pct == pytest.approx(100, abs=0.1)

    @pytest.mark.asyncio
    async def test_expense_breakdown_empty(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """无费用时返回空列表"""
        resp = await client.get(
            f"/books/{test_book.id}/expense-breakdown?start=2020-01-01&end=2020-01-31",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestAssetAllocation:

    @pytest.mark.asyncio
    async def test_asset_allocation(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """资产配置占比"""
        await _create_income(client, test_book.id, 5000, auth_headers)

        resp = await client.get(
            f"/books/{test_book.id}/asset-allocation", headers=auth_headers
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
