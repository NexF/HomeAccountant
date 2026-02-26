"""插件管理功能测试

覆盖端点：
- POST /plugins                      注册插件（API Key 认证）
- GET /plugins                       列出插件（JWT / API Key）
- GET /plugins/{id}                  获取插件详情
- PUT /plugins/{id}/config           更新插件配置（JWT 认证）  ← v0.4.1
- PUT /plugins/{id}/status           更新同步状态（API Key 认证）
- DELETE /plugins/{id}               删除插件（JWT 认证）

覆盖场景：
- 插件注册（新建 + 幂等更新）
- v0.4.1: 注册时上报 config_schema
- 列表 & 详情
- v0.4.1: 插件配置更新（含必填/类型/select/account_select 校验）
- v0.4.1: 重复注册不覆盖已有 config
- v0.4.1: 列表返回 has_config / is_configured
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
        assert data["display_name"] is None  # 未提供时为 null

    @pytest.mark.asyncio
    async def test_register_with_display_name(self, client: AsyncClient, api_key_and_headers):
        """注册时带 display_name → 响应中包含 display_name"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json={
            "name": "bank-monitor-boc",
            "type": "entry",
            "description": "中国银行动账监控",
            "display_name": "中国银行动账记账",
        }, headers=api_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "bank-monitor-boc"
        assert data["display_name"] == "中国银行动账记账"

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
    async def test_register_idempotent_updates_display_name(self, client: AsyncClient, api_key_and_headers):
        """幂等注册时可更新 display_name"""
        _, api_headers = api_key_and_headers
        resp1 = await client.post("/plugins", json={
            "name": "bank-monitor",
            "type": "entry",
            "display_name": "银行动账 v1",
        }, headers=api_headers)
        assert resp1.status_code == 201
        plugin_id = resp1.json()["id"]
        assert resp1.json()["display_name"] == "银行动账 v1"

        # 再次注册更新 display_name
        resp2 = await client.post("/plugins", json={
            "name": "bank-monitor",
            "type": "entry",
            "display_name": "银行动账 v2",
        }, headers=api_headers)
        assert resp2.status_code == 200
        assert resp2.json()["id"] == plugin_id
        assert resp2.json()["display_name"] == "银行动账 v2"

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
    async def test_register_multi_instance_with_display_name(self, client: AsyncClient, api_key_and_headers):
        """同类型插件通过不同 name 注册多实例，各自有独立的 display_name"""
        _, api_headers = api_key_and_headers
        resp1 = await client.post("/plugins", json={
            "name": "bank-monitor-boc",
            "type": "entry",
            "display_name": "中国银行动账记账",
        }, headers=api_headers)
        resp2 = await client.post("/plugins", json={
            "name": "bank-monitor-cmb",
            "type": "entry",
            "display_name": "招商银行动账记账",
        }, headers=api_headers)
        assert resp1.status_code == 201
        assert resp2.status_code == 201
        assert resp1.json()["id"] != resp2.json()["id"]
        assert resp1.json()["display_name"] == "中国银行动账记账"
        assert resp2.json()["display_name"] == "招商银行动账记账"

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
        assert "display_name" in data[0]  # 列表中包含 display_name 字段

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
            "invite_code": "TEST01",
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
        assert "display_name" in resp.json()  # 详情中包含 display_name 字段

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
            "invite_code": "TEST01",
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
            "invite_code": "TEST01",
        })
        other_token = resp.json()["token"]["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        resp = await client.delete(f"/plugins/{plugin_id}", headers=other_headers)
        assert resp.status_code == 404


# ══════════════════════════════════════════════════════════════
# v0.4.1  插件配置相关测试
# ══════════════════════════════════════════════════════════════


SAMPLE_CONFIG_SCHEMA = {
    "fields": [
        {"key": "default_expense", "type": "account_select", "label": "默认支出科目", "required": True},
        {"key": "default_income", "type": "account_select", "label": "默认收入科目", "required": True},
        {"key": "mode", "type": "select", "label": "同步模式", "required": False,
         "options": [{"label": "增量", "value": "incremental"}, {"label": "全量", "value": "full"}],
         "default": "incremental"},
        {"key": "threshold", "type": "number", "label": "最小金额", "required": False},
        {"key": "auto_tag", "type": "boolean", "label": "自动标签", "required": False},
        {"key": "note", "type": "string", "label": "备注", "required": False},
    ]
}


@pytest_asyncio.fixture
async def plugin_with_schema_data():
    """带 config_schema 的插件注册请求体"""
    return {
        "name": "微信账单同步-配置版",
        "type": "entry",
        "description": "带配置的插件",
        "config_schema": SAMPLE_CONFIG_SCHEMA,
    }


@pytest_asyncio.fixture
async def registered_plugin_with_schema(client: AsyncClient, api_key_and_headers, plugin_with_schema_data):
    """注册一个带 config_schema 的插件"""
    _, api_headers = api_key_and_headers
    resp = await client.post("/plugins", json=plugin_with_schema_data, headers=api_headers)
    assert resp.status_code == 201
    return resp.json(), api_headers


# ──────────── 注册时上报 config_schema ────────────


class TestRegisterWithConfigSchema:

    @pytest.mark.asyncio
    async def test_register_with_config_schema(
        self, client: AsyncClient, api_key_and_headers, plugin_with_schema_data
    ):
        """注册时带 config_schema → 详情中返回 config_schema"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json=plugin_with_schema_data, headers=api_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["config_schema"] is not None
        assert len(data["config_schema"]["fields"]) == 6
        assert data["has_config"] is True
        assert data["is_configured"] is False  # 还没填 config

    @pytest.mark.asyncio
    async def test_register_without_config_schema(
        self, client: AsyncClient, api_key_and_headers
    ):
        """注册时不带 config_schema → has_config=False"""
        _, api_headers = api_key_and_headers
        resp = await client.post("/plugins", json={
            "name": "无配置插件", "type": "entry"
        }, headers=api_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["config_schema"] is None
        assert data["config"] is None
        assert data["has_config"] is False
        assert data["is_configured"] is False

    @pytest.mark.asyncio
    async def test_idempotent_register_preserves_config(
        self, client: AsyncClient, auth_headers, api_key_and_headers, plugin_with_schema_data,
        test_book,
    ):
        """重复注册不覆盖已有 config"""
        _, api_headers = api_key_and_headers

        # 1. 注册
        resp = await client.post("/plugins", json=plugin_with_schema_data, headers=api_headers)
        assert resp.status_code == 201
        plugin_id = resp.json()["id"]

        # 2. 获取科目用于填充 config
        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(
                    Account.book_id == test_book.id,
                    Account.code == "5001",
                )
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(
                    Account.book_id == test_book.id,
                    Account.code == "4005",
                )
            )
            income_acct = result.scalar_one()

        # 3. 更新 config
        config_payload = {
            "config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
            }
        }
        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json=config_payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["config"]["default_expense"] == expense_acct.id

        # 4. 再次注册同名插件（可能更新 schema）
        updated_schema = {**plugin_with_schema_data, "config_schema": {
            "fields": [
                {"key": "default_expense", "type": "account_select", "label": "默认支出科目", "required": True},
                {"key": "new_field", "type": "string", "label": "新字段", "required": False},
            ]
        }}
        resp = await client.post("/plugins", json=updated_schema, headers=api_headers)
        assert resp.status_code == 200  # 幂等更新

        # 5. 检查 config 仍然保留
        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        data = resp.json()
        assert data["config"] is not None
        assert data["config"]["default_expense"] == expense_acct.id
        # schema 已更新
        field_keys = [f["key"] for f in data["config_schema"]["fields"]]
        assert "new_field" in field_keys


# ──────────── 更新插件配置 ────────────


class TestUpdatePluginConfig:

    @pytest.mark.asyncio
    async def test_update_config_basic(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """正常更新 config"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
                "mode": "full",
                "threshold": 0.01,
                "auto_tag": True,
                "note": "测试备注",
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["config"]["default_expense"] == expense_acct.id
        assert data["config"]["default_income"] == income_acct.id
        assert data["config"]["mode"] == "full"
        assert data["config"]["threshold"] == 0.01
        assert data["config"]["auto_tag"] is True
        assert data["config"]["note"] == "测试备注"
        assert data["is_configured"] is True

    @pytest.mark.asyncio
    async def test_update_config_required_missing(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """必填字段缺失 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {"mode": "full"}},  # 缺少 default_expense & default_income
            headers=auth_headers,
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["message"] == "配置校验失败"
        error_keys = [e["key"] for e in detail["errors"]]
        assert "default_expense" in error_keys
        assert "default_income" in error_keys

    @pytest.mark.asyncio
    async def test_update_config_required_empty_string(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """必填字段为空字符串 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {"default_expense": "", "default_income": ""}},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_config_number_type_validation(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """number 字段传字符串 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
                "threshold": "not_a_number",
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        error_keys = [e["key"] for e in resp.json()["detail"]["errors"]]
        assert "threshold" in error_keys

    @pytest.mark.asyncio
    async def test_update_config_boolean_type_validation(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """boolean 字段传字符串 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
                "auto_tag": "yes",
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        error_keys = [e["key"] for e in resp.json()["detail"]["errors"]]
        assert "auto_tag" in error_keys

    @pytest.mark.asyncio
    async def test_update_config_select_out_of_range(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """select 字段超出允许范围 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
                "mode": "invalid_mode",
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        error_keys = [e["key"] for e in resp.json()["detail"]["errors"]]
        assert "mode" in error_keys

    @pytest.mark.asyncio
    async def test_update_config_account_select_nonexistent(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """account_select 字段引用不存在的科目 → 422"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": str(uuid.uuid4()),  # 不存在的科目
                "default_income": str(uuid.uuid4()),
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        error_keys = [e["key"] for e in resp.json()["detail"]["errors"]]
        assert "default_expense" in error_keys
        assert "default_income" in error_keys

    @pytest.mark.asyncio
    async def test_update_config_no_schema_plugin(
        self, client: AsyncClient, auth_headers, registered_plugin
    ):
        """无 config_schema 的插件更新配置 → 400"""
        plugin_data, _ = registered_plugin
        plugin_id = plugin_data["id"]

        resp = await client.put(
            f"/plugins/{plugin_id}/config",
            json={"config": {"key": "value"}},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_update_config_requires_jwt(
        self, client: AsyncClient, registered_plugin_with_schema
    ):
        """API Key 不能更新配置 → 401"""
        plugin_data, api_headers = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        resp = await client.put(
            f"/plugins/{plugin_id}/config",
            json={"config": {"key": "value"}},
            headers=api_headers,
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_update_config_default_value(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """非必填字段未提供 → 使用 default 值"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        # 只提供必填字段，mode 有 default="incremental"
        resp = await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
            }},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["config"]["mode"] == "incremental"  # default
        assert data["is_configured"] is True


# ──────────── 插件详情返回 config_schema / config ────────────


class TestPluginDetailConfig:

    @pytest.mark.asyncio
    async def test_detail_returns_config_schema(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema
    ):
        """详情接口返回完整 config_schema"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["config_schema"] is not None
        assert isinstance(data["config_schema"]["fields"], list)
        assert len(data["config_schema"]["fields"]) == 6

    @pytest.mark.asyncio
    async def test_detail_returns_config_after_update(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """更新配置后，详情接口返回 config"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
            }},
            headers=auth_headers,
        )

        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        data = resp.json()
        assert data["config"] is not None
        assert data["config"]["default_expense"] == expense_acct.id
        assert data["config"]["default_income"] == income_acct.id
        assert data["is_configured"] is True


# ──────────── 列表返回 has_config / is_configured ────────────


class TestPluginListConfigStatus:

    @pytest.mark.asyncio
    async def test_list_has_config_true(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema
    ):
        """有 config_schema 的插件 → has_config=True"""
        resp = await client.get("/plugins", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["has_config"] is True
        assert data[0]["is_configured"] is False
        # 列表不返回 config_schema / config 详情
        assert "config_schema" not in data[0]
        assert "config" not in data[0]

    @pytest.mark.asyncio
    async def test_list_has_config_false(
        self, client: AsyncClient, auth_headers, registered_plugin
    ):
        """无 config_schema 的插件 → has_config=False"""
        resp = await client.get("/plugins", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["has_config"] is False
        assert data[0]["is_configured"] is False

    @pytest.mark.asyncio
    async def test_list_is_configured_after_config_update(
        self, client: AsyncClient, auth_headers, registered_plugin_with_schema, test_book
    ):
        """配置完成后 → is_configured=True"""
        plugin_data, _ = registered_plugin_with_schema
        plugin_id = plugin_data["id"]

        from sqlalchemy import select
        from app.models.account import Account
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "5001")
            )
            expense_acct = result.scalar_one()
            result = await db.execute(
                select(Account).where(Account.book_id == test_book.id, Account.code == "4005")
            )
            income_acct = result.scalar_one()

        await client.put(
            f"/plugins/{plugin_id}/config?book_id={test_book.id}",
            json={"config": {
                "default_expense": expense_acct.id,
                "default_income": income_acct.id,
            }},
            headers=auth_headers,
        )

        resp = await client.get("/plugins", headers=auth_headers)
        data = resp.json()
        assert data[0]["is_configured"] is True
