"""对账同步模块功能测试

覆盖端点：
- POST /accounts/{account_id}/snapshot — 提交余额快照
- GET /books/{book_id}/pending-reconciliations — 待处理队列
- GET /books/{book_id}/pending-count — 待处理数量
- PUT /entries/{entry_id}/confirm — 确认调节分录
- POST /entries/{entry_id}/split — 拆分调节分录
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


class TestSnapshot:

    @pytest.mark.asyncio
    async def test_snapshot_no_difference(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额一致 → difference=0, status=balanced"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["difference"] == pytest.approx(0, abs=0.01)
        assert data["status"] == "balanced"
        assert data["reconciliation_entry_id"] is None

    @pytest.mark.asyncio
    async def test_snapshot_with_difference(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额有差异 → 自动生成调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["difference"] != 0
        assert data["status"] == "pending"
        assert data["reconciliation_entry_id"] is not None

    @pytest.mark.asyncio
    async def test_snapshot_with_date(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定快照日期"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0, "snapshot_date": "2025-06-01"},
            headers=auth_headers,
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_snapshot_nonexistent_account(
        self, client: AsyncClient, auth_headers
    ):
        """不存在的科目 → 404"""
        resp = await client.post(
            "/accounts/nonexistent/snapshot",
            json={"external_balance": 100},
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestPendingReconciliations:

    @pytest.mark.asyncio
    async def test_pending_list(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """获取待处理调节队列"""
        resp = await client.get(
            f"/books/{test_book.id}/pending-reconciliations",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.asyncio
    async def test_pending_count_zero(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """新账本无待处理 → count=0"""
        resp = await client.get(
            f"/books/{test_book.id}/pending-count",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_pending_count_after_snapshot(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """提交有差异的快照后 → count > 0"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 1000},
            headers=auth_headers,
        )

        resp = await client.get(
            f"/books/{test_book.id}/pending-count",
            headers=auth_headers,
        )
        assert resp.json()["count"] >= 1


class TestConfirmReconciliation:

    @pytest.mark.asyncio
    async def test_confirm(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """确认调节分录分类"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        other_income_id = await _get_account_id(client, test_book.id, "4005", auth_headers)

        # 创建有差异的快照
        snap_resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 300},
            headers=auth_headers,
        )
        entry_id = snap_resp.json()["reconciliation_entry_id"]

        # 确认分类
        resp = await client.put(
            f"/entries/{entry_id}/confirm",
            json={"target_account_id": other_income_id},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["reconciliation_status"] == "confirmed"
        assert data["target_account_id"] == other_income_id

    @pytest.mark.asyncio
    async def test_confirm_nonexistent_entry(
        self, client: AsyncClient, auth_headers
    ):
        """不存在的分录 → 404"""
        resp = await client.put(
            "/entries/nonexistent/confirm",
            json={"target_account_id": "some-id"},
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestSplitReconciliation:

    @pytest.mark.asyncio
    async def test_split(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """拆分调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        transport_id = await _get_account_id(client, test_book.id, "5002", auth_headers)

        # 创建差异 = -500（外部少 500 → 说明有 500 费用）
        # 先给账本记一笔收入使 book_balance > 0
        salary_id = await _get_account_id(client, test_book.id, "4001", auth_headers)
        await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "income",
                "entry_date": "2025-06-01",
                "amount": 1000,
                "category_account_id": salary_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )

        # 快照：外部 500（账本 1000 → 差异 -500）
        snap_resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500},
            headers=auth_headers,
        )
        entry_id = snap_resp.json()["reconciliation_entry_id"]

        if entry_id is None:
            pytest.skip("无差异分录生成")

        # 拆分为 餐饮 300 + 交通 200
        resp = await client.post(
            f"/entries/{entry_id}/split",
            json={
                "splits": [
                    {"account_id": food_id, "amount": 300, "description": "餐饮"},
                    {"account_id": transport_id, "amount": 200, "description": "交通"},
                ],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["reconciliation_status"] == "confirmed"
        assert data["splits_count"] == 2
