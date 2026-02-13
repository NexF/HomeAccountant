"""账本模块功能测试

覆盖端点：
- POST /books
- GET /books
"""

import pytest
from httpx import AsyncClient

from app.models.book import Book


class TestCreateBook:

    @pytest.mark.asyncio
    async def test_create_personal_book(self, client: AsyncClient, auth_headers):
        """创建个人账本"""
        resp = await client.post("/books", json={
            "name": "我的账本",
            "type": "personal",
        }, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "我的账本"
        assert data["type"] == "personal"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_family_book(self, client: AsyncClient, auth_headers):
        """创建家庭账本"""
        resp = await client.post("/books", json={
            "name": "家庭账本",
            "type": "family",
        }, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["type"] == "family"

    @pytest.mark.asyncio
    async def test_create_book_no_token(self, client: AsyncClient):
        """无 Token → 401"""
        resp = await client.post("/books", json={"name": "test"})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_create_book_invalid_type(self, client: AsyncClient, auth_headers):
        """无效账本类型 → 422"""
        resp = await client.post("/books", json={
            "name": "test",
            "type": "invalid",
        }, headers=auth_headers)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_book_with_preset_accounts(self, client: AsyncClient, auth_headers):
        """创建账本时自动灌入预置科目"""
        resp = await client.post("/books", json={
            "name": "科目测试账本",
        }, headers=auth_headers)
        book_id = resp.json()["id"]

        # 查看科目树
        acct_resp = await client.get(
            f"/books/{book_id}/accounts", headers=auth_headers
        )
        assert acct_resp.status_code == 200
        tree = acct_resp.json()
        assert len(tree["asset"]) > 0
        assert len(tree["liability"]) > 0
        assert len(tree["expense"]) > 0
        assert len(tree["income"]) > 0


class TestListBooks:

    @pytest.mark.asyncio
    async def test_list_books(self, client: AsyncClient, auth_headers, test_book: Book):
        """获取账本列表"""
        resp = await client.get("/books", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(b["id"] == test_book.id for b in data)

    @pytest.mark.asyncio
    async def test_list_books_no_token(self, client: AsyncClient):
        """无 Token → 401"""
        resp = await client.get("/books")
        assert resp.status_code == 401
