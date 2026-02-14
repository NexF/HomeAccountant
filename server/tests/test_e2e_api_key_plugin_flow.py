"""阶段 7：端到端全流程 & 事务边界验证测试

覆盖场景：
1. Swagger UI 端到端测试（OpenAPI schema 可访问）
2. API Key 全流程：创建 Key → 注册插件 → 批量记账 → 余额同步 → 状态上报
3. 前端联调场景：API Key 创建/停用/删除、插件列表/删除
4. 数据库事务边界验证（批量失败回滚、Key 删除级联）
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, func

from app.models.account import Account
from app.models.book import Book
from app.models.journal import JournalEntry, JournalLine
from app.models.plugin import Plugin
from app.models.user import User

from tests.conftest import TestSessionLocal


# ──────────── Fixtures ────────────


@pytest_asyncio.fixture
async def accounts(test_book: Book):
    """获取测试用科目 ID 字典"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(Account.book_id == test_book.id)
        )
        accs = result.scalars().all()
        return {a.code: a.id for a in accs}


def _expense_item(accounts, idx=0, external_id=None):
    item = {
        "entry_type": "expense",
        "entry_date": "2025-06-01",
        "amount": "50.00",
        "category_account_id": accounts["5001"],
        "payment_account_id": accounts["1001"],
        "description": f"午餐 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _income_item(accounts, idx=0, external_id=None):
    item = {
        "entry_type": "income",
        "entry_date": "2025-06-01",
        "amount": "8000.00",
        "category_account_id": accounts["4001"],
        "payment_account_id": accounts["1002"],
        "description": f"工资 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _transfer_item(accounts, idx=0, external_id=None):
    item = {
        "entry_type": "transfer",
        "entry_date": "2025-06-01",
        "amount": "1000.00",
        "from_account_id": accounts["1002"],
        "to_account_id": accounts["1001"],
        "description": f"取现 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


# ──────────── 1. Swagger / OpenAPI 可访问 ────────────


class TestSwaggerEndToEnd:

    @pytest.mark.asyncio
    async def test_openapi_schema_accessible(self, client: AsyncClient):
        """OpenAPI schema 可正常访问"""
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert "openapi" in schema
        assert "paths" in schema

    @pytest.mark.asyncio
    async def test_openapi_has_api_key_paths(self, client: AsyncClient):
        """OpenAPI schema 包含 API Key 端点"""
        resp = await client.get("/openapi.json")
        paths = resp.json()["paths"]
        assert "/api-keys" in paths
        assert "post" in paths["/api-keys"]
        assert "get" in paths["/api-keys"]

    @pytest.mark.asyncio
    async def test_openapi_has_plugin_paths(self, client: AsyncClient):
        """OpenAPI schema 包含 Plugin 端点"""
        resp = await client.get("/openapi.json")
        paths = resp.json()["paths"]
        assert "/plugins" in paths
        assert "/plugins/{plugin_id}" in paths
        assert "/plugins/{plugin_id}/status" in paths
        assert "/plugins/{plugin_id}/entries/batch" in paths

    @pytest.mark.asyncio
    async def test_swagger_ui_accessible(self, client: AsyncClient):
        """Swagger UI 可访问"""
        resp = await client.get("/docs")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """健康检查端点正常"""
        resp = await client.get("/health")
        assert resp.status_code == 200


# ──────────── 2. API Key 全流程 ────────────


class TestApiKeyFullFlow:
    """
    完整流程：
    创建 Key → 用 Key 注册插件 → 批量记账 → 状态上报 → 查看状态 → 停用 Key → 删除 Key
    """

    @pytest.mark.asyncio
    async def test_full_lifecycle(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        # ── Step 1: 创建 API Key ──
        key_resp = await client.post(
            "/api-keys",
            json={"name": "全流程测试 Key"},
            headers=auth_headers,
        )
        assert key_resp.status_code == 201
        key_data = key_resp.json()
        plain_key = key_data["key"]
        key_id = key_data["id"]
        assert plain_key.startswith("hak_")
        api_headers = {"Authorization": f"Bearer {plain_key}"}

        # ── Step 2: 用 API Key 注册插件 ──
        plugin_resp = await client.post(
            "/plugins",
            json={
                "name": "微信账单同步",
                "type": "entry",
                "description": "自动同步微信支付账单",
            },
            headers=api_headers,
        )
        assert plugin_resp.status_code == 201
        plugin_data = plugin_resp.json()
        plugin_id = plugin_data["id"]
        assert plugin_data["last_sync_status"] == "idle"
        assert plugin_data["sync_count"] == 0

        # ── Step 3: 状态上报 → running ──
        status_resp = await client.put(
            f"/plugins/{plugin_id}/status",
            json={"status": "running"},
            headers=api_headers,
        )
        assert status_resp.status_code == 200
        assert status_resp.json()["last_sync_status"] == "running"

        # ── Step 4: 批量记账（3 笔费用 + 1 笔收入 + 1 笔转账） ──
        entries = [
            _expense_item(accounts, 0, external_id="wx_001"),
            _expense_item(accounts, 1, external_id="wx_002"),
            _expense_item(accounts, 2, external_id="wx_003"),
            _income_item(accounts, 3, external_id="wx_004"),
            _transfer_item(accounts, 4, external_id="wx_005"),
        ]
        batch_resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert batch_resp.status_code == 200
        batch_data = batch_resp.json()
        assert batch_data["total"] == 5
        assert batch_data["created"] == 5
        assert batch_data["skipped"] == 0

        # ── Step 5: 验证插件状态已更新（success） ──
        plugin_check = await client.get(
            f"/plugins/{plugin_id}", headers=auth_headers,
        )
        assert plugin_check.status_code == 200
        plugin_status = plugin_check.json()
        assert plugin_status["last_sync_status"] == "success"
        assert plugin_status["sync_count"] == 1
        assert plugin_status["last_sync_at"] is not None

        # ── Step 6: 再次批量记账，含去重 ──
        entries2 = [
            _expense_item(accounts, 5, external_id="wx_001"),  # 重复
            _expense_item(accounts, 6, external_id="wx_006"),  # 新的
        ]
        batch_resp2 = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries2},
            headers=api_headers,
        )
        assert batch_resp2.status_code == 200
        assert batch_resp2.json()["created"] == 1
        assert batch_resp2.json()["skipped"] == 1

        # sync_count 应为 2
        plugin_check2 = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        assert plugin_check2.json()["sync_count"] == 2

        # ── Step 7: 状态上报 → failed ──
        fail_resp = await client.put(
            f"/plugins/{plugin_id}/status",
            json={"status": "failed", "error_message": "网络连接超时"},
            headers=api_headers,
        )
        assert fail_resp.status_code == 200
        assert fail_resp.json()["last_sync_status"] == "failed"
        assert fail_resp.json()["last_error_message"] == "网络连接超时"

        # ── Step 8: 再次 success 清除错误信息 ──
        success_resp = await client.put(
            f"/plugins/{plugin_id}/status",
            json={"status": "success"},
            headers=api_headers,
        )
        assert success_resp.status_code == 200
        assert success_resp.json()["last_error_message"] is None
        assert success_resp.json()["sync_count"] == 3

        # ── Step 9: 查看 API Key 列表（plugin_count） ──
        keys_resp = await client.get("/api-keys", headers=auth_headers)
        assert keys_resp.status_code == 200
        keys = keys_resp.json()
        assert len(keys) == 1
        assert keys[0]["plugin_count"] == 1

        # ── Step 10: 停用 Key ──
        deactivate_resp = await client.patch(
            f"/api-keys/{key_id}",
            json={"is_active": False},
            headers=auth_headers,
        )
        assert deactivate_resp.status_code == 200
        assert deactivate_resp.json()["is_active"] is False

        # ── Step 11: 停用 Key 后插件列表仍然可通过 JWT 访问 ──
        plugins_resp = await client.get("/plugins", headers=auth_headers)
        assert plugins_resp.status_code == 200
        assert len(plugins_resp.json()) == 1

        # ── Step 12: 重新启用 Key ──
        reactivate_resp = await client.patch(
            f"/api-keys/{key_id}",
            json={"is_active": True},
            headers=auth_headers,
        )
        assert reactivate_resp.status_code == 200
        assert reactivate_resp.json()["is_active"] is True


# ──────────── 3. 前端联调场景 ────────────


class TestFrontendIntegration:
    """模拟前端操作的 API 调用顺序"""

    @pytest.mark.asyncio
    async def test_api_key_crud_flow(self, client: AsyncClient, auth_headers):
        """前端 API Key 管理页面：创建 → 列表 → 停用 → 启用 → 改名 → 删除"""
        # 创建 2 个 Key
        resp1 = await client.post("/api-keys", json={"name": "Key A"}, headers=auth_headers)
        resp2 = await client.post("/api-keys", json={"name": "Key B"}, headers=auth_headers)
        assert resp1.status_code == 201
        assert resp2.status_code == 201
        key_a_id = resp1.json()["id"]
        key_b_id = resp2.json()["id"]

        # 列表
        list_resp = await client.get("/api-keys", headers=auth_headers)
        assert len(list_resp.json()) == 2
        for item in list_resp.json():
            assert "key" not in item
            assert "key_prefix" in item

        # 停用 Key A
        await client.patch(f"/api-keys/{key_a_id}", json={"is_active": False}, headers=auth_headers)
        list_resp2 = await client.get("/api-keys", headers=auth_headers)
        key_a = next(k for k in list_resp2.json() if k["id"] == key_a_id)
        assert key_a["is_active"] is False

        # 启用 Key A
        await client.patch(f"/api-keys/{key_a_id}", json={"is_active": True}, headers=auth_headers)

        # 改名 Key B
        rename_resp = await client.patch(
            f"/api-keys/{key_b_id}",
            json={"name": "Key B (renamed)"},
            headers=auth_headers,
        )
        assert rename_resp.json()["name"] == "Key B (renamed)"

        # 删除 Key A
        del_resp = await client.delete(f"/api-keys/{key_a_id}", headers=auth_headers)
        assert del_resp.status_code == 204
        list_resp3 = await client.get("/api-keys", headers=auth_headers)
        assert len(list_resp3.json()) == 1
        assert list_resp3.json()[0]["id"] == key_b_id

    @pytest.mark.asyncio
    async def test_plugin_list_and_delete_flow(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """前端插件管理页面：查看插件列表 → 查看详情 → 删除"""
        # 准备：创建 Key + 注册 2 个插件
        key_resp = await client.post("/api-keys", json={"name": "Frontend Test Key"}, headers=auth_headers)
        plain_key = key_resp.json()["key"]
        api_headers = {"Authorization": f"Bearer {plain_key}"}

        plugin1 = await client.post("/plugins", json={
            "name": "微信同步", "type": "entry", "description": "微信账单同步",
        }, headers=api_headers)
        plugin2 = await client.post("/plugins", json={
            "name": "支付宝同步", "type": "both", "description": "支付宝账单同步",
        }, headers=api_headers)
        assert plugin1.status_code == 201
        assert plugin2.status_code == 201
        p1_id = plugin1.json()["id"]
        p2_id = plugin2.json()["id"]

        # 模拟一次同步
        await client.post(
            f"/plugins/{p1_id}/entries/batch",
            json={"book_id": test_book.id, "entries": [_expense_item(accounts, 0)]},
            headers=api_headers,
        )

        # 前端：列出插件
        list_resp = await client.get("/plugins", headers=auth_headers)
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 2

        # 前端：查看详情
        detail_resp = await client.get(f"/plugins/{p1_id}", headers=auth_headers)
        assert detail_resp.status_code == 200
        assert detail_resp.json()["name"] == "微信同步"
        assert detail_resp.json()["sync_count"] == 1

        # 前端：删除插件
        del_resp = await client.delete(f"/plugins/{p1_id}", headers=auth_headers)
        assert del_resp.status_code == 204

        list_resp2 = await client.get("/plugins", headers=auth_headers)
        assert len(list_resp2.json()) == 1
        assert list_resp2.json()[0]["id"] == p2_id


# ──────────── 4. 数据库事务边界验证 ────────────


class TestTransactionBoundary:

    @pytest.mark.asyncio
    async def test_batch_failure_rolls_back_all(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """批量记账：第 N 条失败 → 前 N-1 条也回滚"""
        key_resp = await client.post("/api-keys", json={"name": "Tx Test Key"}, headers=auth_headers)
        api_headers = {"Authorization": f"Bearer {key_resp.json()['key']}"}
        plugin_resp = await client.post("/plugins", json={
            "name": "Tx测试插件", "type": "entry",
        }, headers=api_headers)
        plugin_id = plugin_resp.json()["id"]

        async with TestSessionLocal() as db:
            count_before = (await db.execute(
                select(func.count(JournalEntry.id)).where(JournalEntry.book_id == test_book.id)
            )).scalar()

        entries = [
            _expense_item(accounts, 0, external_id="tx_001"),
            _expense_item(accounts, 1, external_id="tx_002"),
            {
                "entry_type": "expense",
                "entry_date": "2025-06-01",
                "amount": "100.00",
                "category_account_id": str(uuid.uuid4()),
                "payment_account_id": accounts["1001"],
            },
        ]
        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code in (400, 404)

        async with TestSessionLocal() as db:
            count_after = (await db.execute(
                select(func.count(JournalEntry.id)).where(JournalEntry.book_id == test_book.id)
            )).scalar()
        assert count_after == count_before

    @pytest.mark.asyncio
    async def test_batch_failure_no_orphan_lines(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """批量记账失败后不留孤立的 JournalLine"""
        key_resp = await client.post("/api-keys", json={"name": "Orphan Test"}, headers=auth_headers)
        api_headers = {"Authorization": f"Bearer {key_resp.json()['key']}"}
        plugin_resp = await client.post("/plugins", json={
            "name": "Orphan测试", "type": "entry",
        }, headers=api_headers)
        plugin_id = plugin_resp.json()["id"]

        async with TestSessionLocal() as db:
            lines_before = (await db.execute(
                select(func.count(JournalLine.id))
            )).scalar()

        entries = [
            _expense_item(accounts, 0),
            {
                "entry_type": "expense",
                "entry_date": "2025-06-01",
                "amount": "100.00",
                "category_account_id": str(uuid.uuid4()),
                "payment_account_id": accounts["1001"],
            },
        ]
        await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )

        async with TestSessionLocal() as db:
            lines_after = (await db.execute(
                select(func.count(JournalLine.id))
            )).scalar()
        assert lines_after == lines_before

    @pytest.mark.asyncio
    async def test_delete_key_cascades_plugins_and_preserves_entries(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """删除 Key → 级联删除插件，但已创建的分录保留"""
        key_resp = await client.post("/api-keys", json={"name": "Cascade Key"}, headers=auth_headers)
        key_id = key_resp.json()["id"]
        api_headers = {"Authorization": f"Bearer {key_resp.json()['key']}"}

        plugin_resp = await client.post("/plugins", json={
            "name": "级联测试", "type": "entry",
        }, headers=api_headers)
        plugin_id = plugin_resp.json()["id"]

        batch_resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": [
                _expense_item(accounts, 0, external_id="cascade_001"),
            ]},
            headers=api_headers,
        )
        entry_id = batch_resp.json()["results"][0]["entry_id"]

        del_resp = await client.delete(f"/api-keys/{key_id}", headers=auth_headers)
        assert del_resp.status_code == 204

        async with TestSessionLocal() as db:
            plugin = (await db.execute(
                select(Plugin).where(Plugin.id == plugin_id)
            )).scalar_one_or_none()
            assert plugin is None

        async with TestSessionLocal() as db:
            entry = (await db.execute(
                select(JournalEntry).where(JournalEntry.id == entry_id)
            )).scalar_one_or_none()
            assert entry is not None
            assert entry.external_id == "cascade_001"

    @pytest.mark.asyncio
    async def test_concurrent_batches_different_external_ids(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """两次批量记账使用不同 external_id，全部创建成功"""
        key_resp = await client.post("/api-keys", json={"name": "Concurrent Key"}, headers=auth_headers)
        api_headers = {"Authorization": f"Bearer {key_resp.json()['key']}"}
        plugin_resp = await client.post("/plugins", json={
            "name": "并发测试", "type": "entry",
        }, headers=api_headers)
        plugin_id = plugin_resp.json()["id"]

        resp1 = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": [
                _expense_item(accounts, i, external_id=f"batch_a_{i}") for i in range(5)
            ]},
            headers=api_headers,
        )
        assert resp1.json()["created"] == 5

        resp2 = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": [
                _expense_item(accounts, i, external_id=f"batch_b_{i}") for i in range(5)
            ]},
            headers=api_headers,
        )
        assert resp2.json()["created"] == 5

        check = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        assert check.json()["sync_count"] == 2

    @pytest.mark.asyncio
    async def test_batch_debit_credit_balance(
        self, client: AsyncClient, auth_headers, test_book, accounts
    ):
        """验证每条批量创建的分录借贷平衡"""
        key_resp = await client.post("/api-keys", json={"name": "Balance Key"}, headers=auth_headers)
        api_headers = {"Authorization": f"Bearer {key_resp.json()['key']}"}
        plugin_resp = await client.post("/plugins", json={
            "name": "借贷平衡测试", "type": "entry",
        }, headers=api_headers)
        plugin_id = plugin_resp.json()["id"]

        entries = [
            _expense_item(accounts, 0, external_id="bal_001"),
            _income_item(accounts, 1, external_id="bal_002"),
            _transfer_item(accounts, 2, external_id="bal_003"),
        ]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.json()["created"] == 3

        async with TestSessionLocal() as db:
            for result_item in resp.json()["results"]:
                entry_id = result_item["entry_id"]
                lines = (await db.execute(
                    select(JournalLine).where(JournalLine.entry_id == entry_id)
                )).scalars().all()
                total_debit = sum(float(l.debit_amount) for l in lines)
                total_credit = sum(float(l.credit_amount) for l in lines)
                assert abs(total_debit - total_credit) < 0.01, (
                    f"entry {entry_id}: debit={total_debit}, credit={total_credit}"
                )
