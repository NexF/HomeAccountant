"""账本管理测试（v0.3.0）

覆盖端点：
- PUT /books/{book_id}          更新账本
- DELETE /books/{book_id}       删除账本
- GET /books                    获取账本列表（含 role）
权限校验：
- admin 可更新账本
- member 不可更新账本
- owner 可删除账本
- 非 owner 的 admin 不可删除账本
- 非成员不可操作
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.book import Book, BookMember
from app.models.user import User
from app.utils.security import hash_password, create_access_token
from tests.conftest import TestSessionLocal


# ──────────── 额外 fixture：陌生人用户（不属于任何账本）────────────

@pytest_asyncio.fixture
async def stranger_user() -> User:
    """不属于任何账本的陌生人"""
    async with TestSessionLocal() as db:
        user = User(
            id=str(uuid.uuid4()),
            email="stranger@example.com",
            password_hash=hash_password("password123"),
            nickname="陌生人",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


@pytest_asyncio.fixture
async def stranger_headers(stranger_user: User) -> dict:
    token = create_access_token(stranger_user.id)
    return {"Authorization": f"Bearer {token}"}


# ──────────── 更新账本 ────────────


class TestUpdateBook:

    @pytest.mark.asyncio
    async def test_admin_update_book_name(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """admin 可以修改账本名称"""
        resp = await client.put(
            f"/books/{test_book.id}",
            json={"name": "新账本名"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "新账本名"
        assert data["id"] == test_book.id

    @pytest.mark.asyncio
    async def test_member_cannot_update_book(
        self, client: AsyncClient, member_headers, book_with_member: Book
    ):
        """member 不可修改账本"""
        resp = await client.put(
            f"/books/{book_with_member.id}",
            json={"name": "试图修改"},
            headers=member_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_stranger_cannot_update_book(
        self, client: AsyncClient, stranger_headers, test_book: Book
    ):
        """非成员不可修改账本"""
        resp = await client.put(
            f"/books/{test_book.id}",
            json={"name": "试图修改"},
            headers=stranger_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_nonexistent_book(
        self, client: AsyncClient, auth_headers
    ):
        """更新不存在的账本 → 404"""
        resp = await client.put(
            f"/books/{uuid.uuid4()}",
            json={"name": "test"},
            headers=auth_headers,
        )
        # 权限检查先于 404，非成员会 403
        assert resp.status_code in (403, 404)

    @pytest.mark.asyncio
    async def test_update_book_empty_name(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """空名称 → 422"""
        resp = await client.put(
            f"/books/{test_book.id}",
            json={"name": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_book_no_token(self, client: AsyncClient, test_book: Book):
        """无 Token → 401"""
        resp = await client.put(
            f"/books/{test_book.id}",
            json={"name": "test"},
        )
        assert resp.status_code == 401


# ──────────── 删除账本 ────────────


class TestDeleteBook:

    @pytest.mark.asyncio
    async def test_owner_delete_book(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """owner 可以删除账本"""
        resp = await client.delete(
            f"/books/{test_book.id}", headers=auth_headers
        )
        assert resp.status_code == 204

        # 确认已删除
        resp2 = await client.get("/books", headers=auth_headers)
        assert all(b["id"] != test_book.id for b in resp2.json())

    @pytest.mark.asyncio
    async def test_member_cannot_delete_book(
        self, client: AsyncClient, member_headers, book_with_member: Book
    ):
        """member 不可删除账本"""
        resp = await client.delete(
            f"/books/{book_with_member.id}", headers=member_headers
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_stranger_cannot_delete_book(
        self, client: AsyncClient, stranger_headers, test_book: Book
    ):
        """非成员不可删除账本"""
        resp = await client.delete(
            f"/books/{test_book.id}", headers=stranger_headers
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_nonexistent_book(
        self, client: AsyncClient, auth_headers
    ):
        """删除不存在的账本 → 404"""
        resp = await client.delete(
            f"/books/{uuid.uuid4()}", headers=auth_headers
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_book_no_token(self, client: AsyncClient, test_book: Book):
        """无 Token → 401"""
        resp = await client.delete(f"/books/{test_book.id}")
        assert resp.status_code == 401


# ──────────── GET /books 含 role ────────────


class TestListBooksWithRole:

    @pytest.mark.asyncio
    async def test_list_books_contains_role(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """GET /books 返回的每个账本包含 role 字段"""
        resp = await client.get("/books", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        book_data = next(b for b in data if b["id"] == test_book.id)
        assert book_data["role"] == "admin"

    @pytest.mark.asyncio
    async def test_member_sees_member_role(
        self, client: AsyncClient, member_headers, book_with_member: Book
    ):
        """member 用户看到 role='member'"""
        resp = await client.get("/books", headers=member_headers)
        assert resp.status_code == 200
        data = resp.json()
        book_data = next(b for b in data if b["id"] == book_with_member.id)
        assert book_data["role"] == "member"

    @pytest.mark.asyncio
    async def test_stranger_sees_no_book(
        self, client: AsyncClient, stranger_headers, test_book: Book
    ):
        """非成员看不到该账本"""
        resp = await client.get("/books", headers=stranger_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert all(b["id"] != test_book.id for b in data)
