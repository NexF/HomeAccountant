"""批量记账 API 测试

覆盖端点：
- POST /plugins/{plugin_id}/entries/batch   批量创建分录

覆盖场景：
- 正常批量创建（expense / income / transfer / asset_purchase / borrow / repay）
- external_id 去重（跳过已存在的）
- 科目不存在 → 整体回滚
- 借贷不平衡 → 整体回滚（通过缺少必填字段触发）
- 超过 200 条限制
- 插件状态自动更新
- 认证校验
"""

import uuid
from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.models.account import Account
from app.models.book import Book
from app.models.journal import JournalEntry
from app.models.user import User

from tests.conftest import TestSessionLocal


# ──────────── Fixtures ────────────


@pytest_asyncio.fixture
async def api_key_and_headers(client: AsyncClient, auth_headers):
    """创建 API Key，返回 (key_id, api_headers)"""
    resp = await client.post("/api-keys", json={"name": "Batch Test Key"}, headers=auth_headers)
    data = resp.json()
    return data["id"], {"Authorization": f"Bearer {data['key']}"}


@pytest_asyncio.fixture
async def plugin_id(client: AsyncClient, api_key_and_headers):
    """注册一个 entry 类型插件，返回 plugin_id"""
    _, api_headers = api_key_and_headers
    resp = await client.post("/plugins", json={
        "name": "批量测试插件",
        "type": "entry",
    }, headers=api_headers)
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest_asyncio.fixture
async def accounts(test_book: Book):
    """获取测试用科目 ID 字典"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(Account.book_id == test_book.id)
        )
        accs = result.scalars().all()
        mapping = {a.code: a.id for a in accs}
    return mapping


def _expense_item(accounts, idx=0, external_id=None):
    """构造一条费用分录"""
    item = {
        "entry_type": "expense",
        "entry_date": "2025-06-01",
        "amount": "50.00",
        "category_account_id": accounts["5001"],  # 餐饮
        "payment_account_id": accounts["1001"],   # 现金
        "description": f"午餐 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _income_item(accounts, idx=0, external_id=None):
    """构造一条收入分录"""
    item = {
        "entry_type": "income",
        "entry_date": "2025-06-01",
        "amount": "8000.00",
        "category_account_id": accounts["4001"],  # 工资
        "payment_account_id": accounts["1002"],   # 银行存款
        "description": f"工资 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _transfer_item(accounts, idx=0, external_id=None):
    """构造一条转账分录"""
    item = {
        "entry_type": "transfer",
        "entry_date": "2025-06-01",
        "amount": "1000.00",
        "from_account_id": accounts["1002"],  # 银行存款
        "to_account_id": accounts["1001"],    # 现金
        "description": f"取现 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _asset_purchase_item(accounts, idx=0, external_id=None):
    """构造一条购买资产分录（非固定资产）"""
    item = {
        "entry_type": "asset_purchase",
        "entry_date": "2025-06-01",
        "amount": "3000.00",
        "asset_account_id": accounts["1201"],     # 短期投资
        "payment_account_id": accounts["1002"],   # 银行存款
        "description": f"买基金 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _borrow_item(accounts, idx=0, external_id=None):
    """构造一条借入分录"""
    item = {
        "entry_type": "borrow",
        "entry_date": "2025-06-01",
        "amount": "5000.00",
        "payment_account_id": accounts["1002"],        # 银行存款
        "liability_account_id": accounts["2101"],      # 短期借款
        "description": f"借款 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


def _repay_item(accounts, idx=0, external_id=None):
    """构造一条还款分录"""
    item = {
        "entry_type": "repay",
        "entry_date": "2025-06-01",
        "principal": "1000.00",
        "interest": "50.00",
        "liability_account_id": accounts["2101"],      # 短期借款
        "payment_account_id": accounts["1002"],        # 银行存款
        "category_account_id": accounts["5013"],       # 利息支出
        "description": f"还款 #{idx}",
    }
    if external_id:
        item["external_id"] = external_id
    return item


# ──────────── 正常批量创建 ────────────


class TestBatchCreateNormal:

    @pytest.mark.asyncio
    async def test_batch_expense(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建费用分录"""
        _, api_headers = api_key_and_headers
        entries = [_expense_item(accounts, i) for i in range(3)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["created"] == 3
        assert data["skipped"] == 0
        assert len(data["results"]) == 3
        for r in data["results"]:
            assert r["status"] == "created"
            assert r["entry_id"] is not None

    @pytest.mark.asyncio
    async def test_batch_income(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建收入分录"""
        _, api_headers = api_key_and_headers
        entries = [_income_item(accounts, i) for i in range(2)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["created"] == 2

    @pytest.mark.asyncio
    async def test_batch_transfer(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建转账分录"""
        _, api_headers = api_key_and_headers
        entries = [_transfer_item(accounts, i) for i in range(2)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

    @pytest.mark.asyncio
    async def test_batch_asset_purchase(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建购买资产分录"""
        _, api_headers = api_key_and_headers
        entries = [_asset_purchase_item(accounts, i) for i in range(2)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

    @pytest.mark.asyncio
    async def test_batch_borrow(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建借入分录"""
        _, api_headers = api_key_and_headers
        entries = [_borrow_item(accounts, i) for i in range(2)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

    @pytest.mark.asyncio
    async def test_batch_repay(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建还款分录"""
        _, api_headers = api_key_and_headers
        entries = [_repay_item(accounts, i) for i in range(2)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["created"] == 2

    @pytest.mark.asyncio
    async def test_batch_mixed_types(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量混合 6 种类型"""
        _, api_headers = api_key_and_headers
        entries = [
            _expense_item(accounts, 0),
            _income_item(accounts, 1),
            _transfer_item(accounts, 2),
            _asset_purchase_item(accounts, 3),
            _borrow_item(accounts, 4),
            _repay_item(accounts, 5),
        ]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 6
        assert data["created"] == 6
        assert data["skipped"] == 0

    @pytest.mark.asyncio
    async def test_batch_source_is_sync(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """批量创建的分录 source 应为 sync"""
        _, api_headers = api_key_and_headers
        entries = [_expense_item(accounts, 0)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        entry_id = resp.json()["results"][0]["entry_id"]

        async with TestSessionLocal() as db:
            result = await db.execute(
                select(JournalEntry).where(JournalEntry.id == entry_id)
            )
            entry = result.scalar_one()
            assert entry.source == "sync"


# ──────────── external_id 去重 ────────────


class TestBatchDeduplication:

    @pytest.mark.asyncio
    async def test_skip_duplicate_external_id(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """external_id 重复 → 跳过"""
        _, api_headers = api_key_and_headers
        ext_id = "wechat_pay_20250601_001"

        # 第一次创建
        resp1 = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={
                "book_id": test_book.id,
                "entries": [_expense_item(accounts, 0, external_id=ext_id)],
            },
            headers=api_headers,
        )
        assert resp1.json()["created"] == 1
        original_entry_id = resp1.json()["results"][0]["entry_id"]

        # 第二次创建相同 external_id → 跳过
        resp2 = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={
                "book_id": test_book.id,
                "entries": [_expense_item(accounts, 1, external_id=ext_id)],
            },
            headers=api_headers,
        )
        data = resp2.json()
        assert data["total"] == 1
        assert data["created"] == 0
        assert data["skipped"] == 1
        assert data["results"][0]["status"] == "skipped"
        assert data["results"][0]["entry_id"] == original_entry_id

    @pytest.mark.asyncio
    async def test_mixed_new_and_duplicate(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """混合新条目和重复条目"""
        _, api_headers = api_key_and_headers

        # 先创建一条
        await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={
                "book_id": test_book.id,
                "entries": [_expense_item(accounts, 0, external_id="dup_001")],
            },
            headers=api_headers,
        )

        # 再提交：1 条重复 + 1 条新的
        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={
                "book_id": test_book.id,
                "entries": [
                    _expense_item(accounts, 1, external_id="dup_001"),
                    _expense_item(accounts, 2, external_id="new_001"),
                ],
            },
            headers=api_headers,
        )
        data = resp.json()
        assert data["total"] == 2
        assert data["created"] == 1
        assert data["skipped"] == 1

    @pytest.mark.asyncio
    async def test_no_external_id_always_creates(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """无 external_id 的条目不去重，每次都创建"""
        _, api_headers = api_key_and_headers

        for _ in range(2):
            resp = await client.post(
                f"/plugins/{plugin_id}/entries/batch",
                json={
                    "book_id": test_book.id,
                    "entries": [_expense_item(accounts, 0)],
                },
                headers=api_headers,
            )
            assert resp.json()["created"] == 1

    @pytest.mark.asyncio
    async def test_external_id_stored_on_entry(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """external_id 正确保存到分录"""
        _, api_headers = api_key_and_headers
        ext_id = "test_ext_id_123"

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={
                "book_id": test_book.id,
                "entries": [_expense_item(accounts, 0, external_id=ext_id)],
            },
            headers=api_headers,
        )
        entry_id = resp.json()["results"][0]["entry_id"]

        async with TestSessionLocal() as db:
            result = await db.execute(
                select(JournalEntry).where(JournalEntry.id == entry_id)
            )
            entry = result.scalar_one()
            assert entry.external_id == ext_id


# ──────────── 错误场景 ────────────


class TestBatchErrors:

    @pytest.mark.asyncio
    async def test_invalid_account_rollback(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """科目不存在 → 返回 400 / 404"""
        _, api_headers = api_key_and_headers
        entries = [
            _expense_item(accounts, 0),
            {
                "entry_type": "expense",
                "entry_date": "2025-06-01",
                "amount": "100.00",
                "category_account_id": str(uuid.uuid4()),  # 不存在的科目
                "payment_account_id": accounts["1001"],
            },
        ]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        # 第二条失败，应该报错
        assert resp.status_code in (400, 404)
        assert "第 2 条" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_missing_required_fields(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """缺少必填字段 → 400"""
        _, api_headers = api_key_and_headers
        entries = [
            {
                "entry_type": "expense",
                "entry_date": "2025-06-01",
                "amount": "100.00",
                # 缺少 category_account_id 和 payment_account_id
            },
        ]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_exceed_200_limit(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """超过 200 条限制 → 422"""
        _, api_headers = api_key_and_headers
        entries = [_expense_item(accounts, i) for i in range(201)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_book_id(
        self, client: AsyncClient, api_key_and_headers, plugin_id, accounts
    ):
        """不存在的 book_id → 404"""
        _, api_headers = api_key_and_headers
        entries = [_expense_item(accounts, 0)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": str(uuid.uuid4()), "entries": entries},
            headers=api_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_unsupported_entry_type(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts
    ):
        """不支持的 entry_type (manual) → 422"""
        _, api_headers = api_key_and_headers
        entries = [{
            "entry_type": "manual",
            "entry_date": "2025-06-01",
            "lines": [
                {"account_id": accounts["5001"], "debit_amount": "100", "credit_amount": "0"},
                {"account_id": accounts["1001"], "debit_amount": "0", "credit_amount": "100"},
            ],
        }]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )
        # manual 类型在 batch_entry_service 中会走 case _ 分支抛 ValueError
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_entries(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book
    ):
        """空列表 → 返回 0 条"""
        _, api_headers = api_key_and_headers

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": []},
            headers=api_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["created"] == 0
        assert data["skipped"] == 0


# ──────────── 插件状态更新 ────────────


class TestBatchPluginStatus:

    @pytest.mark.asyncio
    async def test_plugin_status_updated_on_success(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts, auth_headers
    ):
        """批量创建成功后插件状态应更新"""
        _, api_headers = api_key_and_headers
        entries = [_expense_item(accounts, 0)]

        await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=api_headers,
        )

        # 检查插件状态
        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        plugin = resp.json()
        assert plugin["last_sync_status"] == "success"
        assert plugin["sync_count"] == 1
        assert plugin["last_sync_at"] is not None
        assert plugin["last_error_message"] is None

    @pytest.mark.asyncio
    async def test_plugin_sync_count_increments(
        self, client: AsyncClient, api_key_and_headers, plugin_id, test_book, accounts, auth_headers
    ):
        """多次批量创建 → sync_count 递增"""
        _, api_headers = api_key_and_headers

        for i in range(3):
            await client.post(
                f"/plugins/{plugin_id}/entries/batch",
                json={
                    "book_id": test_book.id,
                    "entries": [_expense_item(accounts, i)],
                },
                headers=api_headers,
            )

        resp = await client.get(f"/plugins/{plugin_id}", headers=auth_headers)
        assert resp.json()["sync_count"] == 3


# ──────────── 认证校验 ────────────


class TestBatchAuth:

    @pytest.mark.asyncio
    async def test_requires_api_key(
        self, client: AsyncClient, auth_headers, plugin_id, test_book, accounts
    ):
        """JWT 认证不能调用批量记账 → 401"""
        entries = [_expense_item(accounts, 0)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
            headers=auth_headers,
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_no_auth(
        self, client: AsyncClient, plugin_id, test_book, accounts
    ):
        """无认证 → 401"""
        entries = [_expense_item(accounts, 0)]

        resp = await client.post(
            f"/plugins/{plugin_id}/entries/batch",
            json={"book_id": test_book.id, "entries": entries},
        )
        assert resp.status_code == 401
