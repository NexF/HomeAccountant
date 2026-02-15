"""科目模块功能测试

覆盖端点：
- GET /books/{book_id}/accounts — 科目树
- POST /books/{book_id}/accounts — 新增科目
- PUT /accounts/{account_id} — 编辑科目
- DELETE /accounts/{account_id} — 停用科目
"""

import pytest
from httpx import AsyncClient

from app.models.book import Book
from app.models.account import Account


class TestGetAccountTree:

    @pytest.mark.asyncio
    async def test_get_tree(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """获取科目树 — 五大类分组"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        assert resp.status_code == 200
        tree = resp.json()
        assert "asset" in tree
        assert "liability" in tree
        assert "equity" in tree
        assert "income" in tree
        assert "expense" in tree

    @pytest.mark.asyncio
    async def test_preset_accounts_exist(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """预置科目包含关键科目"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree = resp.json()
        asset_codes = [a["code"] for a in tree["asset"]]
        assert "1001" in asset_codes  # 货币资金
        assert "1002" in asset_codes  # 现金等价物
        assert "1501" in asset_codes  # 固定资产

        expense_codes = [e["code"] for e in tree["expense"]]
        assert "5001" in expense_codes  # 餐饮饮食

    @pytest.mark.asyncio
    async def test_children_loaded(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """子科目正确嵌套（如现金等价物下有货币基金/短期国债）"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree = resp.json()
        bank = next((a for a in tree["asset"] if a["code"] == "1002"), None)
        assert bank is not None
        assert len(bank["children"]) >= 2

    @pytest.mark.asyncio
    async def test_forbidden_other_book(self, client: AsyncClient, auth_headers):
        """无权访问的账本 → 403"""
        resp = await client.get(
            "/books/fake-book-id/accounts", headers=auth_headers
        )
        assert resp.status_code == 403


class TestCreateAccount:

    @pytest.mark.asyncio
    async def test_create_custom_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """新增自定义科目"""
        resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "宠物花销",
                "type": "expense",
                "balance_direction": "debit",
                "icon": "pet",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["code"]  # 编码由系统自动生成
        assert data["name"] == "宠物花销"
        assert data["is_system"] is False

    @pytest.mark.asyncio
    async def test_create_sub_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """新增子科目"""
        # 先获取科目树找到银行存款的 id
        tree_resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        bank = next(a for a in tree_resp.json()["asset"] if a["code"] == "1002")

        resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "建设银行",
                "type": "asset",
                "balance_direction": "debit",
                "parent_id": bank["id"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["parent_id"] == bank["id"]


class TestUpdateAccount:

    @pytest.mark.asyncio
    async def test_update_name(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑科目名称"""
        # 先创建一个自定义科目
        create_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "旧名称",
                "type": "expense",
                "balance_direction": "debit",
            },
            headers=auth_headers,
        )
        account_id = create_resp.json()["id"]

        resp = await client.put(
            f"/accounts/{account_id}",
            json={"name": "新名称"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新名称"

    @pytest.mark.asyncio
    async def test_update_nonexistent(self, client: AsyncClient, auth_headers):
        """编辑不存在的科目 → 404"""
        resp = await client.put(
            "/accounts/nonexistent",
            json={"name": "test"},
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestDeleteAccount:

    @pytest.mark.asyncio
    async def test_deactivate_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """停用科目 → is_active = False"""
        create_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "待停用",
                "type": "expense",
                "balance_direction": "debit",
            },
            headers=auth_headers,
        )
        account_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/accounts/{account_id}", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, client: AsyncClient, auth_headers):
        """停用不存在的科目 → 404"""
        resp = await client.delete(
            "/accounts/nonexistent", headers=auth_headers
        )
        assert resp.status_code == 404
