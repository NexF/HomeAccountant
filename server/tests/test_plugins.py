"""插件管理功能测试

覆盖端点：
- POST /plugins                      注册插件（API Key 认证）
- GET /plugins                       列出插件（JWT / API Key）
- GET /plugins/{id}                  获取插件详情
- PUT /plugins/{id}/status           更新同步状态（API Key 认证）
- DELETE /plugins/{id}               删除插件（JWT 认证）

覆盖场景：
- 插件注册（新建 + 幂等更新）
- 列表 & 详情
- 状态上报（running / success / failed）
- 删除
- 用户隔离
- 认证方式校验
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.user import User
from app.utils.security import hash_password, create_access_token

from tests.conftest import TestSessionLocal


# ──────────── 辅助 Fixtures ────────────


@pytest_asyncio.fixture
async def api_key_and_headers(client: AsyncClient, auth_headers):
    """创建 API Key，返回 (key_id, api_key_headers)"""
    resp = await client.post("/api-keys", json={"name": "Plugin Test Key"}, headers=auth_headers)
    data = resp.json()
    plain_key = data["key"]
    key_id = data["id"]
    headers = {"Authorization": f"Bearer {plain_key}"}
    return key_id, headers


@pytest_asyncio.fixture
async def plugin_data():
    """标准插件注册请求体"""
    return {
        "name": "微信账单同步",
        "type": "entry",
        "description": "自动同步微信支付账单",
    }


@pytest_asyncio.fixture
async def registered_plugin(client: AsyncClient, api_key_and_headers, plugin_data):
    """注册一个插件，返回 (plugin_data, api_key_headers)"""
    _, api_headers = api_key_and_headers
    resp = await client.post("/plugins", json=plugin_data, headers=api_headers)
    assert resp.status_code == 201
    return resp.json(), api_headers


# ──────────── 注册插件 ────────────


class TestRegisterPlugin:

    @pytest.mark.asyncio
    async def test_register_new_plugin(self, client: AsyncClient, api_key_and_headers, plugin_data):
        """新建插件 → 201"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json=plugin_data, headers=api_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "微信账单同步"
        assert data["type"] == "entry"
        assert data["description"] == "自动同步微信支付账单"
        assert data["last_sync_status"] == "idle"
        assert data["sync_count"] == 0
        assert data["last_sync_at"] is None

    @pytest.mark.asyncio
    async def test_register_idempotent(self, client: AsyncClient, api_key_and_headers, plugin_data):
        """同名插件再次注册 → 200（幂等更新）"""
        _, api_headers = api_key_and_headers
        resp1 = await client.post("/plugins", json=plugin_data, headers=api_headers)
        assert resp1.status_code == 201
        plugin_id = resp1.json()["id"]

        # 再次注册同名插件（修改描述）
        updated_data = {**plugin_data, "description": "更新后的描述"}
        resp2 = await client.post("/plugins", json=updated_data, headers=api_headers)
        assert resp2.status_code == 200
        assert resp2.json()["id"] == plugin_id
        assert resp2.json()["description"] == "更新后的描述"

    @pytest.mark.asyncio
    async def test_register_different_names(self, client: AsyncClient, api_key_and_headers):
        """不同名称 → 创建不同插件"""
        _, api_headers = api_key_and_headers
        resp1 = await client.post("/plugins", json={
            "name": "插件A", "type": "entry",
        }, headers=api_headers)
        resp2 = await client.post("/plugins", json={
            "name": "插件B", "type": "balance",
        }, headers=api_headers)
        assert resp1.status_code == 201
        assert resp2.status_code == 201
        assert resp1.json()["id"] != resp2.json()["id"]

    @pytest.mark.asyncio
    async def test_register_requires_api_key(self, client: AsyncClient, auth_headers, plugin_data):
        """JWT 认证不能注册插件 → 401"""
        resp = await client.post("/plugins", json=plugin_data, headers=auth_headers)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_register_no_auth(self, client: AsyncClient, plugin_data):
        """无认证 → 401"""
        resp = await client.post("/plugins", json=plugin_data)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_register_invalid_type(self, client: AsyncClient, api_key_and_headers):
        """无效 type → 422"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json={
            "name": "test", "type": "invalid",
        }, headers=api_headers)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_register_missing_name(self, client: AsyncClient, api_key_and_headers):
        """缺少 name → 422"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json={
            "type": "entry",
        }, headers=api_headers)
        assert resp.status_code == 422


# ──────────── 列表插件 ────────────


class TestListPlugins:

    @pytest.mark.asyncio
    async def test_list_empty(self, client: AsyncClient, auth_headers):
        """无插件 → 空列表"""
        resp = await client.get("/plugins", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_with_jwt(self, client: AsyncClient, auth_headers, registered_plugin):
        """JWT 认证可列出插件"""
        resp = await client.get("/plugins", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "微信账单同步"

    @pytest.mark.asyncio
    async def test_list_with_api_key(self, client: AsyncClient, registered_plugin):
        """API Key 认证可列出插件"""
        _, api_headers = registered_plugin
        resp = await client.get("/plugins", headers=api_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    @pytest.mark.asyncio
    async def test_list_user_isolation(self, client: AsyncClient, auth_headers, registered_plugin):
        """用户之间的插件互相不可见"""
        # 注册第二个用户
        resp = await client.post("/auth/register", json={
            "email": "other_plugin@example.com",
            "password": "password123",
        })
        other_token = resp.json()["token"]["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        resp = await client.get("/plugins", headers=other_headers)
        assert resp.status_code == 200
        assert resp.json() == []


# ──────────── 获取插件详情 ────────────


class TestGetPlugin:

    @pytest.mark.asyncio
    async def test_get_plugin(self, client: AsyncClient, auth_headers, registered_plugin):
        """获取插件详情"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == plugin_id
        assert resp.json()["name"] == "微信账单同步"

    @pytest.mark.asyncio
    async def test_get_nonexistent(self, client: AsyncClient, auth_headers):
        """不存在的插件 → 404"""
        resp = await client.get(f"/plugins/{uuid.uuid4()}", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_other_user_plugin(self, client: AsyncClient, registered_plugin):
        """其他用户无法获取别人的插件 → 404"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]

        # 注册第二个用户
        from httpx import AsyncClient as _
        resp = await client.post("/auth/register", json={
            "email": "other_get@example.com",
            "password": "password123",
        })
        other_token = resp.json()["token"]["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        resp = await client.get(f"/plugins/{plugin_id}", headers=other_headers)
        assert resp.status_code == 404


# ──────────── 更新同步状态 ────────────


class TestUpdatePluginStatus:

    @pytest.mark.asyncio
    async def test_status_running(self, client: AsyncClient, registered_plugin):
        """上报 running 状态"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "running",
        }, headers=api_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_sync_status"] == "running"
        # running 不更新 sync_at
        assert data["last_sync_at"] is None
        assert data["sync_count"] == 0

    @pytest.mark.asyncio
    async def test_status_success(self, client: AsyncClient, registered_plugin):
        """上报 success 状态 → sync_count +1"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "success",
        }, headers=api_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_sync_status"] == "success"
        assert data["last_sync_at"] is not None
        assert data["sync_count"] == 1
        assert data["last_error_message"] is None

    @pytest.mark.asyncio
    async def test_status_success_increments(self, client: AsyncClient, registered_plugin):
        """多次上报 success → sync_count 递增"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]

        for i in range(3):
            await client.put(f"/plugins/{plugin_id}/status", json={
                "status": "success",
            }, headers=api_headers)

        resp = await client.get(f"/plugins/{plugin_id}", headers=api_headers)
        assert resp.json()["sync_count"] == 3

    @pytest.mark.asyncio
    async def test_status_failed(self, client: AsyncClient, registered_plugin):
        """上报 failed 状态 → 记录错误信息"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "failed",
            "error_message": "连接超时",
        }, headers=api_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_sync_status"] == "failed"
        assert data["last_sync_at"] is not None
        assert data["last_error_message"] == "连接超时"

    @pytest.mark.asyncio
    async def test_status_success_clears_error(self, client: AsyncClient, registered_plugin):
        """success 后清除 error_message"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]

        # 先 failed
        await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "failed", "error_message": "出错了",
        }, headers=api_headers)

        # 再 success
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "success",
        }, headers=api_headers)
        assert resp.json()["last_error_message"] is None

    @pytest.mark.asyncio
    async def test_status_requires_api_key(self, client: AsyncClient, auth_headers, registered_plugin):
        """JWT 不能更新状态 → 401"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "success",
        }, headers=auth_headers)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_status_invalid_value(self, client: AsyncClient, registered_plugin):
        """无效 status 值 → 422"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.put(f"/plugins/{plugin_id}/status", json={
            "status": "invalid_status",
        }, headers=api_headers)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_status_nonexistent_plugin(self, client: AsyncClient, api_key_and_headers):
        """不存在的插件 → 404"""
        _, api_headers = api_key_and_headers
        resp = await client.put(f"/plugins/{uuid.uuid4()}/status", json={
            "status": "success",
        }, headers=api_headers)
        assert resp.status_code == 404


# ──────────── 删除插件 ────────────


class TestDeletePlugin:

    @pytest.mark.asyncio
    async def test_delete_plugin(self, client: AsyncClient, auth_headers, registered_plugin):
        """删除插件 → 204"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.delete(f"/plugins/{plugin_id}", headers=auth_headers)
        assert resp.status_code == 204

        # 确认已删除
        resp = await client.get("/plugins", headers=auth_headers)
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, client: AsyncClient, auth_headers):
        """删除不存在的插件 → 404"""
        resp = await client.delete(f"/plugins/{uuid.uuid4()}", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_requires_jwt(self, client: AsyncClient, registered_plugin):
        """API Key 不能删除插件 → 401（端点只接受 JWT）"""
        plugin_data, api_headers = registered_plugin
        plugin_id = plugin_data["id"]
        resp = await client.delete(f"/plugins/{plugin_id}", headers=api_headers)
        # API Key 格式的 Bearer token 不被 get_current_user（JWT）接受
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_other_user_plugin(self, client: AsyncClient, registered_plugin):
        """不能删除其他用户的插件 → 404"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]

        resp = await client.post("/auth/register", json={
            "email": "other_delete@example.com",
            "password": "password123",
        })
        other_token = resp.json()["token"]["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        resp = await client.delete(f"/plugins/{plugin_id}", headers=other_headers)
        assert resp.status_code == 404
