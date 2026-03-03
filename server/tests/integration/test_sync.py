"""对账同步模块功能测试

覆盖端点：
- POST /accounts/{account_id}/snapshot — 提交余额快照
- 已删除端点返回 404/405
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

    @pytest.mark.asyncio
    async def test_snapshot_with_difference_default_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额有差异，无调账科目 → 使用系统默认科目生成调节分录，status=reconciled"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["difference"] != 0
        assert data["status"] == "reconciled"

    @pytest.mark.asyncio
    async def test_snapshot_with_adjust_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定调账科目 → 使用该科目生成调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        income_id = await _get_account_id(client, test_book.id, "4005", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 800, "adjust_account_id": income_id},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "reconciled"

    @pytest.mark.asyncio
    async def test_snapshot_invalid_adjust_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """无效的调账科目 → 报错"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500, "adjust_account_id": "nonexistent"},
            headers=auth_headers,
        )
        # 差异 != 0 时尝试使用无效科目 → 应返回错误
        assert resp.status_code in (400, 404)

    @pytest.mark.asyncio
    async def test_deleted_endpoints_return_404(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """已删除的端点返回 404/405"""
        resp1 = await client.get(
            f"/books/{test_book.id}/pending-reconciliations",
            headers=auth_headers,
        )
        assert resp1.status_code in (404, 405)

        resp2 = await client.get(
            f"/books/{test_book.id}/pending-count",
            headers=auth_headers,
        )
        assert resp2.status_code in (404, 405)

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
