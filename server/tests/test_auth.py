"""认证模块功能测试

覆盖端点：
- POST /auth/register
- POST /auth/login
- GET /auth/me
- PUT /auth/profile
"""

import pytest
from httpx import AsyncClient


class TestRegister:

    @pytest.mark.asyncio
    async def test_register_success(self, client: AsyncClient):
        """注册成功 → 返回用户信息 + Token + 自动创建默认账本"""
        resp = await client.post("/auth/register", json={
            "email": "new@example.com",
            "password": "123456",
            "nickname": "新用户",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "user" in data
        assert "token" in data
        assert data["user"]["email"] == "new@example.com"
        assert data["user"]["nickname"] == "新用户"
        assert data["token"]["access_token"]
        assert data["token"]["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client: AsyncClient):
        """重复邮箱注册 → 409"""
        payload = {"email": "dup@example.com", "password": "123456"}
        await client.post("/auth/register", json=payload)
        resp = await client.post("/auth/register", json=payload)
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_register_short_password(self, client: AsyncClient):
        """密码太短 → 422"""
        resp = await client.post("/auth/register", json={
            "email": "short@example.com",
            "password": "123",
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_register_invalid_email(self, client: AsyncClient):
        """无效邮箱格式 → 422"""
        resp = await client.post("/auth/register", json={
            "email": "not-an-email",
            "password": "123456",
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_register_creates_default_book(self, client: AsyncClient):
        """注册后自动创建个人账本"""
        resp = await client.post("/auth/register", json={
            "email": "bookcheck@example.com",
            "password": "123456",
        })
        token = resp.json()["token"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        books_resp = await client.get("/books", headers=headers)
        assert books_resp.status_code == 200
        books = books_resp.json()
        assert len(books) >= 1
        assert books[0]["name"] == "个人账本"


class TestLogin:

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient):
        """正确邮箱+密码 → 登录成功"""
        await client.post("/auth/register", json={
            "email": "login@example.com",
            "password": "password123",
        })
        resp = await client.post("/auth/login", json={
            "email": "login@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["email"] == "login@example.com"
        assert data["token"]["access_token"]

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient):
        """密码错误 → 401"""
        await client.post("/auth/register", json={
            "email": "wrongpw@example.com",
            "password": "password123",
        })
        resp = await client.post("/auth/login", json={
            "email": "wrongpw@example.com",
            "password": "wrongpassword",
        })
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client: AsyncClient):
        """不存在的用户 → 401"""
        resp = await client.post("/auth/login", json={
            "email": "noone@example.com",
            "password": "123456",
        })
        assert resp.status_code == 401


class TestGetMe:

    @pytest.mark.asyncio
    async def test_get_me(self, client: AsyncClient, auth_headers):
        """GET /auth/me → 返回当前用户信息"""
        resp = await client.get("/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "test@example.com"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_get_me_no_token(self, client: AsyncClient):
        """无 Token → 401"""
        resp = await client.get("/auth/me")
        assert resp.status_code == 401


class TestUpdateProfile:

    @pytest.mark.asyncio
    async def test_update_nickname(self, client: AsyncClient, auth_headers):
        """更新昵称"""
        resp = await client.put("/auth/profile", json={
            "nickname": "新昵称",
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["nickname"] == "新昵称"

    @pytest.mark.asyncio
    async def test_update_currency(self, client: AsyncClient, auth_headers):
        """更新货币"""
        resp = await client.put("/auth/profile", json={
            "currency": "USD",
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["currency"] == "USD"

    @pytest.mark.asyncio
    async def test_update_avatar(self, client: AsyncClient, auth_headers):
        """更新头像"""
        resp = await client.put("/auth/profile", json={
            "avatar_url": "https://example.com/avatar.png",
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["avatar_url"] == "https://example.com/avatar.png"
