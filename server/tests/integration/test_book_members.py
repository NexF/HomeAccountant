"""账本成员管理测试（v0.3.0）

覆盖端点：
- GET    /books/{book_id}/members              获取成员列表
- POST   /books/{book_id}/members              邀请成员
- PUT    /books/{book_id}/members/{user_id}    修改成员角色
- DELETE /books/{book_id}/members/{user_id}    移除成员
- POST   /books/{book_id}/leave                退出账本

权限校验：
- admin 可邀请/移除/修改角色（仅 family 账本）
- member 不可邀请/移除/修改角色
- owner 不可被移除/修改角色/退出
- personal 账本不可邀请成员
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.book import Book, BookMember
from app.models.user import User
from app.utils.security import hash_password, create_access_token
from tests.conftest import TestSessionLocal


# ──────────── 额外 Fixtures ────────────

@pytest_asyncio.fixture
async def invitee_user() -> User:
    """待邀请的新用户"""
    async with TestSessionLocal() as db:
        user = User(
            id=str(uuid.uuid4()),
            email="invitee@example.com",
            password_hash=hash_password("password123"),
            nickname="待邀请",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


@pytest_asyncio.fixture
async def stranger_user() -> User:
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


# ──────────── 获取成员列表 ────────────


class TestGetMembers:

    @pytest.mark.asyncio
    async def test_admin_get_members(
        self, client: AsyncClient, auth_headers, test_book: Book, test_user: User
    ):
        """admin 可查看成员列表"""
        resp = await client.get(
            f"/books/{test_book.id}/members", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        owner_member = next(m for m in data if m["user_id"] == test_user.id)
        assert owner_member["role"] == "admin"
        assert owner_member["is_owner"] is True

    @pytest.mark.asyncio
    async def test_member_get_members(
        self, client: AsyncClient, member_headers, book_with_member: Book
    ):
        """member 也可查看成员列表"""
        resp = await client.get(
            f"/books/{book_with_member.id}/members", headers=member_headers
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 2  # owner + member

    @pytest.mark.asyncio
    async def test_stranger_cannot_get_members(
        self, client: AsyncClient, stranger_headers, test_book: Book
    ):
        """非成员不可查看成员列表"""
        resp = await client.get(
            f"/books/{test_book.id}/members", headers=stranger_headers
        )
        assert resp.status_code == 403


# ──────────── 邀请成员 ────────────


class TestInviteMember:

    @pytest.mark.asyncio
    async def test_invite_by_email(
        self, client: AsyncClient, auth_headers, family_book: Book, invitee_user: User
    ):
        """admin 通过邮箱邀请成员（family 账本）"""
        resp = await client.post(
            f"/books/{family_book.id}/members",
            json={"email": "invitee@example.com", "role": "member"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["user_id"] == invitee_user.id
        assert data["email"] == "invitee@example.com"
        assert data["role"] == "member"
        assert data["is_owner"] is False

    @pytest.mark.asyncio
    async def test_invite_as_admin(
        self, client: AsyncClient, auth_headers, family_book: Book, invitee_user: User
    ):
        """邀请成员为 admin 角色"""
        resp = await client.post(
            f"/books/{family_book.id}/members",
            json={"email": "invitee@example.com", "role": "admin"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "admin"

    @pytest.mark.asyncio
    async def test_invite_default_role_member(
        self, client: AsyncClient, auth_headers, family_book: Book, invitee_user: User
    ):
        """默认角色为 member"""
        resp = await client.post(
            f"/books/{family_book.id}/members",
            json={"email": "invitee@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "member"

    @pytest.mark.asyncio
    async def test_invite_unregistered_email(
        self, client: AsyncClient, auth_headers, family_book: Book
    ):
        """邀请未注册邮箱 → 404"""
        resp = await client.post(
            f"/books/{family_book.id}/members",
            json={"email": "nonexist@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_invite_already_member(
        self, client: AsyncClient, auth_headers, family_book_with_member: Book, member_user: User
    ):
        """邀请已是成员的用户 → 400"""
        resp = await client.post(
            f"/books/{family_book_with_member.id}/members",
            json={"email": "member@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_member_cannot_invite(
        self, client: AsyncClient, member_headers, family_book_with_member: Book, invitee_user: User
    ):
        """member 不可邀请成员"""
        resp = await client.post(
            f"/books/{family_book_with_member.id}/members",
            json={"email": "invitee@example.com"},
            headers=member_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_invite_invalid_role(
        self, client: AsyncClient, auth_headers, family_book: Book, invitee_user: User
    ):
        """无效角色 → 422"""
        resp = await client.post(
            f"/books/{family_book.id}/members",
            json={"email": "invitee@example.com", "role": "superadmin"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_personal_book_cannot_invite(
        self, client: AsyncClient, auth_headers, test_book: Book, invitee_user: User
    ):
        """个人账本不可邀请成员 → 400"""
        resp = await client.post(
            f"/books/{test_book.id}/members",
            json={"email": "invitee@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "个人账本" in resp.json()["detail"]


# ──────────── 修改成员角色 ────────────


class TestUpdateMemberRole:

    @pytest.mark.asyncio
    async def test_change_member_to_admin(
        self, client: AsyncClient, auth_headers, family_book_with_member: Book, member_user: User
    ):
        """admin 将 member 提升为 admin"""
        resp = await client.put(
            f"/books/{family_book_with_member.id}/members/{member_user.id}",
            json={"role": "admin"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"

    @pytest.mark.asyncio
    async def test_change_admin_to_member(
        self, client: AsyncClient, auth_headers, family_book_with_member: Book, member_user: User
    ):
        """先升级再降级"""
        # 升级
        await client.put(
            f"/books/{family_book_with_member.id}/members/{member_user.id}",
            json={"role": "admin"},
            headers=auth_headers,
        )
        # 降级
        resp = await client.put(
            f"/books/{family_book_with_member.id}/members/{member_user.id}",
            json={"role": "member"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "member"

    @pytest.mark.asyncio
    async def test_cannot_change_owner_role(
        self, client: AsyncClient, auth_headers, test_book: Book, test_user: User
    ):
        """不可修改 owner 的角色"""
        resp = await client.put(
            f"/books/{test_book.id}/members/{test_user.id}",
            json={"role": "member"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_member_cannot_change_role(
        self, client: AsyncClient, member_headers, family_book_with_member: Book, member_user: User
    ):
        """member 不可修改角色"""
        resp = await client.put(
            f"/books/{family_book_with_member.id}/members/{member_user.id}",
            json={"role": "admin"},
            headers=member_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_change_nonexistent_member(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """修改不存在的成员 → 404"""
        resp = await client.put(
            f"/books/{test_book.id}/members/{uuid.uuid4()}",
            json={"role": "admin"},
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ──────────── 移除成员 ────────────


class TestRemoveMember:

    @pytest.mark.asyncio
    async def test_admin_remove_member(
        self, client: AsyncClient, auth_headers, family_book_with_member: Book, member_user: User
    ):
        """admin 可移除 member"""
        resp = await client.delete(
            f"/books/{family_book_with_member.id}/members/{member_user.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 204

        # 确认已移除
        members_resp = await client.get(
            f"/books/{family_book_with_member.id}/members", headers=auth_headers
        )
        member_ids = [m["user_id"] for m in members_resp.json()]
        assert member_user.id not in member_ids

    @pytest.mark.asyncio
    async def test_cannot_remove_owner(
        self, client: AsyncClient, auth_headers, test_book: Book, test_user: User
    ):
        """不可移除 owner"""
        resp = await client.delete(
            f"/books/{test_book.id}/members/{test_user.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_member_cannot_remove(
        self, client: AsyncClient, member_headers, family_book_with_member: Book, test_user: User
    ):
        """member 不可移除其他成员"""
        resp = await client.delete(
            f"/books/{family_book_with_member.id}/members/{test_user.id}",
            headers=member_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_remove_nonexistent_member(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """移除不存在的成员 → 404"""
        resp = await client.delete(
            f"/books/{test_book.id}/members/{uuid.uuid4()}",
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ──────────── 退出账本 ────────────


class TestLeaveBook:

    @pytest.mark.asyncio
    async def test_member_leave_book(
        self, client: AsyncClient, member_headers, family_book_with_member: Book, member_user: User
    ):
        """member 可以退出账本"""
        resp = await client.post(
            f"/books/{family_book_with_member.id}/leave", headers=member_headers
        )
        assert resp.status_code == 204

        # 确认已退出：member 看不到该账本
        books_resp = await client.get("/books", headers=member_headers)
        assert all(b["id"] != family_book_with_member.id for b in books_resp.json())

    @pytest.mark.asyncio
    async def test_owner_cannot_leave(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """owner 不可退出账本"""
        resp = await client.post(
            f"/books/{test_book.id}/leave", headers=auth_headers
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_stranger_cannot_leave(
        self, client: AsyncClient, stranger_headers, test_book: Book
    ):
        """非成员不可退出"""
        resp = await client.post(
            f"/books/{test_book.id}/leave", headers=stranger_headers
        )
        assert resp.status_code == 403
