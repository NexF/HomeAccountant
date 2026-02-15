"""
预算管理 API 测试
- POST /books/{book_id}/budgets — 新建预算
- GET /books/{book_id}/budgets — 列表
- GET /budgets/{id} — 详情
- PUT /budgets/{id} — 更新
- DELETE /budgets/{id} — 删除
- GET /books/{book_id}/budgets/overview — 总览
- POST /books/{book_id}/budgets/check — 预算检查
"""

import pytest

from app.models.book import Book
from app.models.account import Account


# ──────────── fixtures ────────────

@pytest.fixture
def expense_account_id():
    """获取餐饮费用科目ID (5001) — 需要 test_book 创建后查找"""
    pass  # 通过 API 动态获取


# ──────────── 基本 CRUD ────────────

class TestBudgetCRUD:

    @pytest.mark.asyncio
    async def test_create_total_budget(self, client, auth_headers, test_book: Book):
        """创建总预算"""
        resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 10000, "alert_threshold": 0.8},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["account_id"] is None
        assert data["amount"] == 10000
        assert data["alert_threshold"] == 0.8
        assert data["is_active"] is True
        assert data["status"] == "normal"
        assert data["used_amount"] == 0

    @pytest.mark.asyncio
    async def test_create_category_budget(self, client, auth_headers, test_book: Book):
        """创建分类预算"""
        # 获取餐饮费用科目
        acct_resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        expense_accounts = acct_resp.json()["expense"]
        food_account = next(a for a in expense_accounts if a["code"] == "5001")

        resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"account_id": food_account["id"], "amount": 3000},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["account_id"] == food_account["id"]
        assert data["account_name"] is not None
        assert data["amount"] == 3000

    @pytest.mark.asyncio
    async def test_create_duplicate_budget(self, client, auth_headers, test_book: Book):
        """不允许重复创建同科目预算"""
        await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 10000},
            headers=auth_headers,
        )
        resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 20000},
            headers=auth_headers,
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_list_budgets(self, client, auth_headers, test_book: Book):
        """获取预算列表"""
        await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 10000},
            headers=auth_headers,
        )
        resp = await client.get(
            f"/books/{test_book.id}/budgets", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

    @pytest.mark.asyncio
    async def test_get_budget_detail(self, client, auth_headers, test_book: Book):
        """获取预算详情"""
        create_resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 5000},
            headers=auth_headers,
        )
        budget_id = create_resp.json()["id"]

        resp = await client.get(
            f"/budgets/{budget_id}", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == budget_id

    @pytest.mark.asyncio
    async def test_update_budget(self, client, auth_headers, test_book: Book):
        """更新预算"""
        create_resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 5000},
            headers=auth_headers,
        )
        budget_id = create_resp.json()["id"]

        resp = await client.put(
            f"/budgets/{budget_id}",
            json={"amount": 8000, "alert_threshold": 0.7},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["amount"] == 8000
        assert data["alert_threshold"] == 0.7

    @pytest.mark.asyncio
    async def test_delete_budget(self, client, auth_headers, test_book: Book):
        """删除预算"""
        create_resp = await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 5000},
            headers=auth_headers,
        )
        budget_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/budgets/{budget_id}", headers=auth_headers
        )
        assert resp.status_code == 204

        # 确认已删除
        resp = await client.get(
            f"/budgets/{budget_id}", headers=auth_headers
        )
        assert resp.status_code == 404


# ──────────── 总览 & 预算检查 ────────────

class TestBudgetOverviewAndCheck:

    @pytest.mark.asyncio
    async def test_overview_no_budget(self, client, auth_headers, test_book: Book):
        """无预算时总览"""
        resp = await client.get(
            f"/books/{test_book.id}/budgets/overview", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_budget"] is None
        assert data["total_status"] == "not_set"

    @pytest.mark.asyncio
    async def test_overview_with_budget(self, client, auth_headers, test_book: Book):
        """有预算时总览"""
        await client.post(
            f"/books/{test_book.id}/budgets",
            json={"amount": 10000},
            headers=auth_headers,
        )
        resp = await client.get(
            f"/books/{test_book.id}/budgets/overview", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_budget"] == 10000
        assert data["total_used"] == 0
        assert data["total_status"] == "normal"

    @pytest.mark.asyncio
    async def test_budget_check_triggers_warning(
        self, client, auth_headers, test_book: Book
    ):
        """记费用后触发预算预警"""
        from datetime import date

        # 获取费用科目
        acct_resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        expense_accounts = acct_resp.json()["expense"]
        food_account = next(a for a in expense_accounts if a["code"] == "5001")
        # 获取资产科目（叶子节点）
        asset_accounts = acct_resp.json()["asset"]
        cash_equiv = next(a for a in asset_accounts if a["code"] == "1002")
        bank_account = next(c for c in cash_equiv["children"] if c["code"] == "1002-01")

        # 设置分类预算 3000，阈值 80%
        await client.post(
            f"/books/{test_book.id}/budgets",
            json={"account_id": food_account["id"], "amount": 3000, "alert_threshold": 0.8},
            headers=auth_headers,
        )

        today = date.today().isoformat()

        # 记费用 2500（= 83% > 80%，应触发 warning）
        await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": today,
                "amount": 2500,
                "category_account_id": food_account["id"],
                "payment_account_id": bank_account["id"],
                "description": "餐饮",
            },
            headers=auth_headers,
        )

        # 检查预算
        resp = await client.post(
            f"/books/{test_book.id}/budgets/check?account_id={food_account['id']}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["triggered"] is True
        assert len(data["alerts"]) >= 1
        assert data["alerts"][0]["alert_type"] == "warning"

    @pytest.mark.asyncio
    async def test_budget_check_triggers_exceeded(
        self, client, auth_headers, test_book: Book
    ):
        """记费用后触发超支告警"""
        from datetime import date

        acct_resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        expense_accounts = acct_resp.json()["expense"]
        food_account = next(a for a in expense_accounts if a["code"] == "5001")
        asset_accounts = acct_resp.json()["asset"]
        cash_equiv = next(a for a in asset_accounts if a["code"] == "1002")
        bank_account = next(c for c in cash_equiv["children"] if c["code"] == "1002-01")

        await client.post(
            f"/books/{test_book.id}/budgets",
            json={"account_id": food_account["id"], "amount": 3000, "alert_threshold": 0.8},
            headers=auth_headers,
        )

        today = date.today().isoformat()

        # 记费用 3100（> 100%，应触发 exceeded）
        await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": today,
                "amount": 3100,
                "category_account_id": food_account["id"],
                "payment_account_id": bank_account["id"],
                "description": "餐饮超支",
            },
            headers=auth_headers,
        )

        resp = await client.post(
            f"/books/{test_book.id}/budgets/check?account_id={food_account['id']}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["triggered"] is True
        assert data["alerts"][0]["alert_type"] == "exceeded"
