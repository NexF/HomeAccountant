"""分录类型转换测试

覆盖端点：POST /entries/{entry_id}/convert

测试用例：
- 费用 → 资产购置（成功）
- 资产购置 → 费用（成功）
- 费用 → 转账（成功）
- 不允许的转换路径 → 400 错误
- sync 来源分录 → 400 错误
- 转换后借贷平衡校验
- 原分录 ID 保留不变
"""

import pytest
from httpx import AsyncClient

from app.models.book import Book


# ═══════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════

async def _get_account_id(client, book_id, code, headers):
    """从科目树中查找指定 code 的科目 ID"""
    resp = await client.get(f"/books/{book_id}/accounts", headers=headers)
    tree = resp.json()
    for group in tree.values():
        for acct in group:
            if acct["code"] == code:
                return acct["id"]
            for child in acct.get("children", []):
                if child["code"] == code:
                    return child["id"]
    return None


async def _create_expense(client, book_id, headers, amount=100):
    """创建一笔费用分录，返回响应 JSON"""
    food_id = await _get_account_id(client, book_id, "5001", headers)
    cash_id = await _get_account_id(client, book_id, "1001-01", headers)
    resp = await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "expense",
            "entry_date": "2025-06-15",
            "amount": amount,
            "category_account_id": food_id,
            "payment_account_id": cash_id,
            "description": "测试费用",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


async def _create_asset_purchase(client, book_id, headers, amount=5000):
    """创建一笔资产购置分录，返回响应 JSON"""
    # 使用流动资产科目（非固定资产，避免需要 asset_name）
    other_asset_id = await _get_account_id(client, book_id, "1009", headers)
    if not other_asset_id:
        # 如果 1009 不存在，用银行存款 1002 作为资产科目
        other_asset_id = await _get_account_id(client, book_id, "1002-01", headers)
    cash_id = await _get_account_id(client, book_id, "1001-01", headers)
    resp = await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "asset_purchase",
            "entry_date": "2025-06-15",
            "amount": amount,
            "asset_account_id": other_asset_id,
            "payment_account_id": cash_id,
            "description": "购置资产",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


async def _create_transfer(client, book_id, headers, amount=200):
    """创建一笔转账分录，返回响应 JSON"""
    cash_id = await _get_account_id(client, book_id, "1001-01", headers)
    bank_id = await _get_account_id(client, book_id, "1002-01", headers)
    resp = await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "transfer",
            "entry_date": "2025-06-15",
            "amount": amount,
            "from_account_id": cash_id,
            "to_account_id": bank_id,
            "description": "现金转银行",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


async def _create_income(client, book_id, headers, amount=1000):
    """创建一笔收入分录，返回响应 JSON"""
    salary_id = await _get_account_id(client, book_id, "4001", headers)
    bank_id = await _get_account_id(client, book_id, "1002-01", headers)
    resp = await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "income",
            "entry_date": "2025-06-01",
            "amount": amount,
            "category_account_id": salary_id,
            "payment_account_id": bank_id,
            "description": "工资",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _assert_balanced(data):
    """断言借贷平衡"""
    total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
    total_credit = sum(float(l["credit_amount"]) for l in data["lines"])
    assert total_debit == pytest.approx(total_credit), (
        f"借贷不平衡: 借方 {total_debit}, 贷方 {total_credit}"
    )
    return total_debit


# ═══════════════════════════════════════════
# 费用 → 资产购置
# ═══════════════════════════════════════════


class TestExpenseToAssetPurchase:

    @pytest.mark.asyncio
    async def test_expense_to_asset_purchase(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用 → 资产购置：成功转换"""
        expense = await _create_expense(client, test_book.id, auth_headers, amount=100)
        entry_id = expense["id"]
        original_created_at = expense["created_at"]

        # 获取资产科目用于转换
        bank_id = await _get_account_id(client, test_book.id, "1002-01", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "asset_purchase",
                "category_account_id": bank_id,  # 作为资产科目
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        # entry_type 已变更
        assert data["entry_type"] == "asset_purchase"
        # ID 保留不变
        assert data["id"] == entry_id
        # created_at 保留不变
        assert data["created_at"] == original_created_at
        # 借贷平衡
        total = _assert_balanced(data)
        assert total == pytest.approx(100)


# ═══════════════════════════════════════════
# 资产购置 → 费用
# ═══════════════════════════════════════════


class TestAssetPurchaseToExpense:

    @pytest.mark.asyncio
    async def test_asset_purchase_to_expense(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """资产购置 → 费用：成功转换"""
        purchase = await _create_asset_purchase(client, test_book.id, auth_headers, amount=5000)
        entry_id = purchase["id"]
        original_created_at = purchase["created_at"]

        # 获取费用科目
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "expense",
                "category_account_id": food_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["entry_type"] == "expense"
        assert data["id"] == entry_id
        assert data["created_at"] == original_created_at
        total = _assert_balanced(data)
        assert total == pytest.approx(5000)


# ═══════════════════════════════════════════
# 费用 → 转账
# ═══════════════════════════════════════════


class TestExpenseToTransfer:

    @pytest.mark.asyncio
    async def test_expense_to_transfer(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用 → 转账：成功转换"""
        expense = await _create_expense(client, test_book.id, auth_headers, amount=300)
        entry_id = expense["id"]

        # 转账需要 from/to，使用 category 作为 to，payment 作为 from
        bank_id = await _get_account_id(client, test_book.id, "1002-01", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "transfer",
                "category_account_id": bank_id,   # to
                "payment_account_id": cash_id,     # from
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["entry_type"] == "transfer"
        assert data["id"] == entry_id
        total = _assert_balanced(data)
        assert total == pytest.approx(300)


# ═══════════════════════════════════════════
# 转账 → 费用
# ═══════════════════════════════════════════


class TestTransferToExpense:

    @pytest.mark.asyncio
    async def test_transfer_to_expense(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """转账 → 费用：成功转换"""
        transfer = await _create_transfer(client, test_book.id, auth_headers, amount=200)
        entry_id = transfer["id"]

        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "expense",
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["entry_type"] == "expense"
        assert data["id"] == entry_id
        total = _assert_balanced(data)
        assert total == pytest.approx(200)


# ═══════════════════════════════════════════
# 转账 → 收入
# ═══════════════════════════════════════════


class TestTransferToIncome:

    @pytest.mark.asyncio
    async def test_transfer_to_income(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """转账 → 收入：成功转换"""
        transfer = await _create_transfer(client, test_book.id, auth_headers, amount=500)
        entry_id = transfer["id"]

        salary_id = await _get_account_id(client, test_book.id, "4001", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002-01", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "income",
                "category_account_id": salary_id,
                "payment_account_id": bank_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["entry_type"] == "income"
        total = _assert_balanced(data)
        assert total == pytest.approx(500)


# ═══════════════════════════════════════════
# 收入 → 还款
# ═══════════════════════════════════════════


class TestIncomeToRepay:

    @pytest.mark.asyncio
    async def test_income_to_repay(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """收入 → 还款：成功转换"""
        income = await _create_income(client, test_book.id, auth_headers, amount=1000)
        entry_id = income["id"]

        liability_id = await _get_account_id(client, test_book.id, "2101", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002-01", auth_headers)

        resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "repay",
                "category_account_id": liability_id,  # 负债科目
                "payment_account_id": bank_id,         # 支付科目
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["entry_type"] == "repay"
        assert data["id"] == entry_id
        total = _assert_balanced(data)
        assert total == pytest.approx(1000)


# ═══════════════════════════════════════════
# 不允许的转换路径 → 400
# ═══════════════════════════════════════════


class TestDisallowedConversions:

    @pytest.mark.asyncio
    async def test_expense_to_income_not_allowed(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用 → 收入：不允许"""
        expense = await _create_expense(client, test_book.id, auth_headers)

        resp = await client.post(
            f"/entries/{expense['id']}/convert",
            json={"target_type": "income"},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "不支持" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_expense_to_borrow_not_allowed(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用 → 借入：不允许"""
        expense = await _create_expense(client, test_book.id, auth_headers)

        resp = await client.post(
            f"/entries/{expense['id']}/convert",
            json={"target_type": "borrow"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_income_to_expense_not_allowed(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """收入 → 费用：不允许"""
        income = await _create_income(client, test_book.id, auth_headers)

        resp = await client.post(
            f"/entries/{income['id']}/convert",
            json={"target_type": "expense"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_borrow_to_expense_not_allowed(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """借入类型分录无转换路径 → 400"""
        bank_id = await _get_account_id(client, test_book.id, "1002-01", auth_headers)
        liability_id = await _get_account_id(client, test_book.id, "2101", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "borrow",
                "entry_date": "2025-06-15",
                "amount": 10000,
                "payment_account_id": bank_id,
                "liability_account_id": liability_id,
                "description": "借款",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        borrow = resp.json()

        resp = await client.post(
            f"/entries/{borrow['id']}/convert",
            json={"target_type": "expense"},
            headers=auth_headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════
# sync 来源分录也可以转换
# ═══════════════════════════════════════════


class TestSyncEntryConvert:

    @pytest.mark.asyncio
    async def test_sync_entry_can_convert(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """sync 来源的分录也支持类型转换"""
        from datetime import date as dt_date
        from tests.conftest import TestSessionLocal
        from app.models.journal import JournalEntry, JournalLine
        from app.models.user import User
        from sqlalchemy import select
        import uuid

        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)

        # 直接在数据库中创建一条 source=sync 的分录
        async with TestSessionLocal() as db:
            user = (await db.execute(select(User))).scalar_one()
            entry = JournalEntry(
                id=str(uuid.uuid4()),
                book_id=test_book.id,
                user_id=user.id,
                entry_date=dt_date(2025, 6, 15),
                entry_type="expense",
                source="sync",
                description="同步分录",
            )
            entry.lines = [
                JournalLine(account_id=food_id, debit_amount=50, credit_amount=0),
                JournalLine(account_id=cash_id, debit_amount=0, credit_amount=50),
            ]
            db.add(entry)
            await db.commit()
            sync_entry_id = entry.id

        resp = await client.post(
            f"/entries/{sync_entry_id}/convert",
            json={"target_type": "transfer", "category_account_id": cash_id, "payment_account_id": cash_id},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["entry_type"] == "transfer"
        assert data["source"] == "sync"
        assert data["id"] == sync_entry_id


# ═══════════════════════════════════════════
# 分录不存在 → 404
# ═══════════════════════════════════════════


class TestConvertNotFound:

    @pytest.mark.asyncio
    async def test_entry_not_found(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """转换不存在的分录 → 404"""
        resp = await client.post(
            "/entries/non-existent-id/convert",
            json={"target_type": "transfer"},
            headers=auth_headers,
        )
        assert resp.status_code == 400 or resp.status_code == 404
