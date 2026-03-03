"""管理后台接口测试 (v0.4.0) — 18 个用例"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.config import settings
from app.models.user import User
from app.models.book import Book, BookMember
from app.utils.security import hash_password, create_access_token

from tests.conftest import TestSessionLocal


# ──────────── helpers ────────────

ADMIN_PASSWORD = settings.ADMIN_PASSWORD


async def _admin_login(client: AsyncClient) -> str:
    """登录管理后台，返回 admin_token"""
    resp = await client.post("/admin/login", json={"password": ADMIN_PASSWORD})
    assert resp.status_code == 200
    return resp.json()["admin_token"]


def _admin_headers(token: str) -> dict:
    return {"X-Admin-Token": token}


# ──────────── fixtures ────────────

@pytest_asyncio.fixture
async def admin_token(client: AsyncClient) -> str:
    return await _admin_login(client)


@pytest_asyncio.fixture
async def admin_hdrs(admin_token: str) -> dict:
    return _admin_headers(admin_token)


@pytest_asyncio.fixture
async def second_user() -> User:
    """第二个用户用于搜索/封禁测试"""
    async with TestSessionLocal() as db:
        user = User(
            id=str(uuid.uuid4()),
            email="alice@test.com",
            password_hash=hash_password("password123"),
            nickname="Alice",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


@pytest_asyncio.fixture
async def second_book(second_user: User) -> Book:
    """给第二个用户创建一本账本"""
    async with TestSessionLocal() as db:
        book = Book(
            id=str(uuid.uuid4()),
            name="Alice的账本",
            type="family",
            owner_id=second_user.id,
        )
        db.add(book)
        await db.flush()
        db.add(BookMember(book_id=book.id, user_id=second_user.id, role="admin"))
        await db.commit()
        await db.refresh(book)
        return book


# ===================================================================
# AD-1: POST /admin/login 正确密码 → 200
# ===================================================================

class TestAdminLogin:
    @pytest.mark.asyncio
    async def test_login_ok(self, client: AsyncClient):
        resp = await client.post("/admin/login", json={"password": ADMIN_PASSWORD})
        assert resp.status_code == 200
        data = resp.json()
        assert "admin_token" in data
        assert data["expires_in"] == 120 * 60

    # AD-2: 错误密码 → 403
    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient):
        resp = await client.post("/admin/login", json={"password": "wrong"})
        assert resp.status_code == 403
        assert "管理密码错误" in resp.json()["detail"]

    # AD-3: 未配置 ADMIN_PASSWORD → 404
    @pytest.mark.asyncio
    async def test_login_no_password_configured(self, client: AsyncClient):
        original = settings.ADMIN_PASSWORD
        settings.ADMIN_PASSWORD = ""
        try:
            resp = await client.post("/admin/login", json={"password": "any"})
            assert resp.status_code == 404
        finally:
            settings.ADMIN_PASSWORD = original


# ===================================================================
# AD-4 ~ AD-6: GET /admin/stats
# ===================================================================

class TestAdminStats:
    # AD-4: 无 token → 422
    @pytest.mark.asyncio
    async def test_stats_no_token(self, client: AsyncClient):
        resp = await client.get("/admin/stats")
        assert resp.status_code == 422

    # AD-5: 无效 token → 401
    @pytest.mark.asyncio
    async def test_stats_invalid_token(self, client: AsyncClient):
        resp = await client.get("/admin/stats", headers={"X-Admin-Token": "bad-token"})
        assert resp.status_code == 401

    # AD-6: 正常 → 200
    @pytest.mark.asyncio
    async def test_stats_ok(self, client: AsyncClient, admin_hdrs: dict, test_user: User, test_book: Book):
        resp = await client.get("/admin/stats", headers=admin_hdrs)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_users"] >= 1
        assert data["total_books"] >= 1
        assert "total_entries" in data
        assert "today_new_users" in data
        assert "weekly_active_users" in data


# ===================================================================
# AD-7 ~ AD-9: GET /admin/users
# ===================================================================

class TestAdminUsers:
    # AD-7: 分页 → 200
    @pytest.mark.asyncio
    async def test_users_list(self, client: AsyncClient, admin_hdrs: dict, test_user: User):
        resp = await client.get("/admin/users", headers=admin_hdrs)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1
        assert data["page"] == 1

    # AD-8: 搜索 → 200
    @pytest.mark.asyncio
    async def test_users_search(self, client: AsyncClient, admin_hdrs: dict, test_user: User, second_user: User):
        resp = await client.get("/admin/users", headers=admin_hdrs, params={"search": "alice"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["email"] == "alice@test.com"

    # AD-9: 状态筛选 → 200
    @pytest.mark.asyncio
    async def test_users_filter_active(self, client: AsyncClient, admin_hdrs: dict, test_user: User):
        resp = await client.get("/admin/users", headers=admin_hdrs, params={"status": "active"})
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert item["is_active"] is True


# ===================================================================
# AD-10 ~ AD-14: 用户详情 / 编辑 / 封禁 / 解封
# ===================================================================

class TestAdminUserDetail:
    # AD-10: 存在 → 200
    @pytest.mark.asyncio
    async def test_user_detail_ok(self, client: AsyncClient, admin_hdrs: dict, test_user: User, test_book: Book):
        resp = await client.get(f"/admin/users/{test_user.id}", headers=admin_hdrs)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "test@example.com"
        assert data["book_count"] >= 1

    # AD-11: 不存在 → 404
    @pytest.mark.asyncio
    async def test_user_detail_not_found(self, client: AsyncClient, admin_hdrs: dict):
        resp = await client.get(f"/admin/users/{uuid.uuid4()}", headers=admin_hdrs)
        assert resp.status_code == 404

    # AD-12: 修改昵称 → 200
    @pytest.mark.asyncio
    async def test_update_user_nickname(self, client: AsyncClient, admin_hdrs: dict, test_user: User):
        resp = await client.patch(
            f"/admin/users/{test_user.id}",
            headers=admin_hdrs,
            json={"nickname": "新昵称"},
        )
        assert resp.status_code == 200
        assert resp.json()["nickname"] == "新昵称"

    # AD-13: 封禁 → 200, is_active=false
    @pytest.mark.asyncio
    async def test_ban_user(self, client: AsyncClient, admin_hdrs: dict, second_user: User):
        resp = await client.post(f"/admin/users/{second_user.id}/ban", headers=admin_hdrs)
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    # AD-14: 解封 → 200, is_active=true
    @pytest.mark.asyncio
    async def test_unban_user(self, client: AsyncClient, admin_hdrs: dict, second_user: User):
        # 先封禁
        await client.post(f"/admin/users/{second_user.id}/ban", headers=admin_hdrs)
        # 再解封
        resp = await client.post(f"/admin/users/{second_user.id}/unban", headers=admin_hdrs)
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True


# ===================================================================
# AD-15 ~ AD-16: 封禁用户登录 / 调用 API
# ===================================================================

class TestBannedUser:
    # AD-15: 封禁用户登录 → 403
    @pytest.mark.asyncio
    async def test_banned_user_login(self, client: AsyncClient, admin_hdrs: dict, second_user: User):
        # 封禁
        await client.post(f"/admin/users/{second_user.id}/ban", headers=admin_hdrs)
        # 尝试登录
        resp = await client.post("/auth/login", json={
            "email": "alice@test.com",
            "password": "password123",
        })
        assert resp.status_code == 403
        assert "封禁" in resp.json()["detail"]

    # AD-16: 封禁用户 token 调用 API → 403
    @pytest.mark.asyncio
    async def test_banned_user_token_rejected(self, client: AsyncClient, admin_hdrs: dict, second_user: User):
        # 先拿到 token
        user_token = create_access_token(second_user.id)
        user_headers = {"Authorization": f"Bearer {user_token}"}

        # 封禁
        await client.post(f"/admin/users/{second_user.id}/ban", headers=admin_hdrs)

        # 用 token 调用需要鉴权的 API
        resp = await client.get("/auth/me", headers=user_headers)
        assert resp.status_code == 403
        assert "封禁" in resp.json()["detail"]


# ===================================================================
# AD-17 ~ AD-18: GET /admin/books
# ===================================================================

class TestAdminBooks:
    # AD-17: 分页 → 200
    @pytest.mark.asyncio
    async def test_books_list(self, client: AsyncClient, admin_hdrs: dict, test_book: Book):
        resp = await client.get("/admin/books", headers=admin_hdrs)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert data["total"] >= 1
        item = data["items"][0]
        assert "owner_email" in item
        assert "member_count" in item
        assert "entry_count" in item

    # AD-18: 搜索 → 200
    @pytest.mark.asyncio
    async def test_books_search(
        self, client: AsyncClient, admin_hdrs: dict,
        test_book: Book, second_user: User, second_book: Book,
    ):
        resp = await client.get("/admin/books", headers=admin_hdrs, params={"search": "Alice"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Alice的账本"
