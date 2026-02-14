"""分录/记账模块功能测试

覆盖端点：
- POST /books/{book_id}/entries — 7 种类型分录创建
- GET /books/{book_id}/entries — 分录列表（分页+筛选）
- GET /entries/{entry_id} — 分录详情
- PUT /entries/{entry_id} — 编辑分录
- DELETE /entries/{entry_id} — 删除分录

覆盖复式记账核心：借贷平衡验证
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


# ═══════════════════════════════════════════
# 费用分录
# ═══════════════════════════════════════════


class TestExpenseEntry:

    @pytest.mark.asyncio
    async def test_create_expense(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """记一笔费用：借 餐饮饮食(5001)，贷 现金(1001)"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 50,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
                "description": "午餐",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["entry_type"] == "expense"
        assert data["is_balanced"] is True
        assert len(data["lines"]) == 2

        # 验证借贷平衡
        total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
        total_credit = sum(float(l["credit_amount"]) for l in data["lines"])
        assert total_debit == pytest.approx(total_credit)
        assert total_debit == pytest.approx(50)

    @pytest.mark.asyncio
    async def test_expense_missing_fields(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """费用分录缺少必填字段 → 400"""
        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 50,
                # 缺少 category_account_id 和 payment_account_id
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════
# 收入分录
# ═══════════════════════════════════════════


class TestIncomeEntry:

    @pytest.mark.asyncio
    async def test_create_income(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """记一笔收入：借 银行存款(1002)，贷 工资薪金(4001)"""
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)
        salary_id = await _get_account_id(client, test_book.id, "4001", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "income",
                "entry_date": "2025-06-01",
                "amount": 15000,
                "category_account_id": salary_id,
                "payment_account_id": bank_id,
                "description": "6月工资",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["entry_type"] == "income"
        assert data["is_balanced"] is True

        total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
        assert total_debit == pytest.approx(15000)


# ═══════════════════════════════════════════
# 转账分录
# ═══════════════════════════════════════════


class TestTransferEntry:

    @pytest.mark.asyncio
    async def test_transfer(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """转账：从现金到银行存款"""
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "transfer",
                "entry_date": "2025-06-15",
                "amount": 1000,
                "from_account_id": cash_id,
                "to_account_id": bank_id,
                "description": "存款",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["entry_type"] == "transfer"
        assert data["is_balanced"] is True
        assert len(data["lines"]) == 2


# ═══════════════════════════════════════════
# 借入分录
# ═══════════════════════════════════════════


class TestBorrowEntry:

    @pytest.mark.asyncio
    async def test_borrow(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """借入：借 银行存款(1002)，贷 短期借款(2101)"""
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)
        loan_id = await _get_account_id(client, test_book.id, "2101", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "borrow",
                "entry_date": "2025-06-01",
                "amount": 50000,
                "payment_account_id": bank_id,
                "liability_account_id": loan_id,
                "description": "借款",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["is_balanced"] is True


# ═══════════════════════════════════════════
# 还款分录
# ═══════════════════════════════════════════


class TestRepayEntry:

    @pytest.mark.asyncio
    async def test_repayment(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """还款：借 短期借款(本金) + 利息支出(利息)，贷 银行存款"""
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)
        loan_id = await _get_account_id(client, test_book.id, "2101", auth_headers)
        interest_id = await _get_account_id(client, test_book.id, "5013", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "repay",
                "entry_date": "2025-07-01",
                "principal": 5000,
                "interest": 200,
                "liability_account_id": loan_id,
                "payment_account_id": bank_id,
                "category_account_id": interest_id,
                "description": "还款",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_balanced"] is True
        # 总贷方 = 本金 + 利息 = 5200
        total_credit = sum(float(l["credit_amount"]) for l in data["lines"])
        assert total_credit == pytest.approx(5200)


# ═══════════════════════════════════════════
# 购买资产分录
# ═══════════════════════════════════════════


class TestAssetPurchaseEntry:

    @pytest.mark.asyncio
    async def test_asset_purchase(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """购买资产：借 固定资产(1501)，贷 银行存款(1002)"""
        asset_acct_id = await _get_account_id(client, test_book.id, "1501", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "asset_purchase",
                "entry_date": "2025-06-01",
                "amount": 8000,
                "asset_account_id": asset_acct_id,
                "payment_account_id": bank_id,
                "description": "购买笔记本电脑",
                "asset_name": "笔记本电脑",
                "useful_life_months": 36,
                "residual_rate": 5,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["entry_type"] == "asset_purchase"
        assert data["is_balanced"] is True
        # 固定资产科目应自动创建 FixedAsset 记录
        assert data["asset_id"] is not None

    @pytest.mark.asyncio
    async def test_asset_purchase_with_loan(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """贷款购买资产：借 固定资产，贷 银行存款 + 长期借款"""
        asset_acct_id = await _get_account_id(client, test_book.id, "1501", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)
        loan_id = await _get_account_id(client, test_book.id, "2201", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "asset_purchase",
                "entry_date": "2025-06-01",
                "amount": 1000000,
                "asset_account_id": asset_acct_id,
                "payment_account_id": bank_id,
                "extra_liability_account_id": loan_id,
                "extra_liability_amount": 700000,
                "description": "贷款买房",
                "asset_name": "住宅",
                "useful_life_months": 240,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_balanced"] is True
        assert data["asset_id"] is not None
        # 贷方合计 = 300000(银行) + 700000(贷款) = 1000000
        total_credit = sum(float(l["credit_amount"]) for l in data["lines"])
        assert total_credit == pytest.approx(1000000)


# ═══════════════════════════════════════════
# 手动分录
# ═══════════════════════════════════════════


class TestManualEntry:

    @pytest.mark.asyncio
    async def test_manual_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """手动分录：自行构建借贷行"""
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "manual",
                "entry_date": "2025-06-15",
                "description": "手动调整",
                "lines": [
                    {"account_id": cash_id, "debit_amount": 500, "credit_amount": 0},
                    {"account_id": bank_id, "debit_amount": 0, "credit_amount": 500},
                ],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["is_balanced"] is True

    @pytest.mark.asyncio
    async def test_manual_entry_insufficient_lines(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """手动分录少于 2 行 → 400"""
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "manual",
                "entry_date": "2025-06-15",
                "lines": [
                    {"account_id": cash_id, "debit_amount": 500, "credit_amount": 0},
                ],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════
# 列表 / 详情 / 编辑 / 删除
# ═══════════════════════════════════════════


class TestEntryCRUD:

    @pytest.mark.asyncio
    async def test_list_entries(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """分录列表（分页）"""
        # 先创建一条
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 30,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )

        resp = await client.get(
            f"/books/{test_book.id}/entries", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1

    @pytest.mark.asyncio
    async def test_list_filter_by_type(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """按类型筛选分录"""
        resp = await client.get(
            f"/books/{test_book.id}/entries?entry_type=expense",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert item["entry_type"] == "expense"

    @pytest.mark.asyncio
    async def test_list_filter_by_date(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """按日期范围筛选"""
        resp = await client.get(
            f"/books/{test_book.id}/entries?start_date=2025-06-01&end_date=2025-06-30",
            headers=auth_headers,
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_get_entry_detail(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """分录详情含 lines"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 25,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        resp = await client.get(f"/entries/{entry_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == entry_id
        assert len(data["lines"]) == 2
        # lines 含科目名称
        assert data["lines"][0]["account_name"] is not None

    @pytest.mark.asyncio
    async def test_get_detail_not_found(self, client: AsyncClient, auth_headers):
        """不存在的分录 → 404"""
        resp = await client.get("/entries/nonexistent", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_update_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑分录元数据"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 20,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
                "description": "原描述",
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        resp = await client.put(
            f"/entries/{entry_id}",
            json={"description": "新描述", "note": "备注"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "新描述"
        assert resp.json()["note"] == "备注"

    @pytest.mark.asyncio
    async def test_delete_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """删除分录 → 204"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 10,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        resp = await client.delete(f"/entries/{entry_id}", headers=auth_headers)
        assert resp.status_code == 204

        # 确认已删除
        get_resp = await client.get(f"/entries/{entry_id}", headers=auth_headers)
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_forbidden_book(self, client: AsyncClient, auth_headers):
        """无权访问的账本 → 403"""
        resp = await client.post(
            "/books/fake-book-id/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 10,
                "category_account_id": "x",
                "payment_account_id": "y",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 403


# ═══════════════════════════════════════════
# v0.1.1 — 分录完整编辑
# ═══════════════════════════════════════════


class TestEntryFullEdit:
    """v0.1.1 分录完整编辑测试：科目、金额、所有业务字段可修改，ID 不变"""

    @pytest.mark.asyncio
    async def test_edit_expense_account_and_amount(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑费用分录：改科目+金额，旧 lines 删除，新 lines 生成"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        transport_id = await _get_account_id(client, test_book.id, "5002", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        # 创建原始分录
        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 50,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
                "description": "午餐",
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        entry_id = create_resp.json()["id"]
        created_at = create_resp.json()["created_at"]

        # 编辑：改科目和金额
        resp = await client.put(
            f"/entries/{entry_id}",
            json={
                "amount": 100,
                "category_account_id": transport_id,
                "payment_account_id": bank_id,
                "description": "打车",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()

        # ID 不变
        assert data["id"] == entry_id
        # created_at 不变
        assert data["created_at"] == created_at
        # 描述已更新
        assert data["description"] == "打车"
        # 借贷平衡
        assert data["is_balanced"] is True
        # lines 已重建
        assert len(data["lines"]) == 2
        total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
        total_credit = sum(float(l["credit_amount"]) for l in data["lines"])
        assert total_debit == pytest.approx(100)
        assert total_credit == pytest.approx(100)

        # 验证科目已更换
        account_ids = {l["account_id"] for l in data["lines"]}
        assert transport_id in account_ids
        assert bank_id in account_ids

    @pytest.mark.asyncio
    async def test_edit_income_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑收入分录"""
        salary_id = await _get_account_id(client, test_book.id, "4001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "income",
                "entry_date": "2025-06-15",
                "amount": 5000,
                "category_account_id": salary_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        # 编辑：改收款账户和金额
        resp = await client.put(
            f"/entries/{entry_id}",
            json={
                "amount": 8000,
                "category_account_id": salary_id,
                "payment_account_id": bank_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == entry_id
        total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
        assert total_debit == pytest.approx(8000)

    @pytest.mark.asyncio
    async def test_edit_transfer_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑转账分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)
        bank_id = await _get_account_id(client, test_book.id, "1002", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "transfer",
                "entry_date": "2025-06-15",
                "amount": 1000,
                "from_account_id": cash_id,
                "to_account_id": bank_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        # 编辑：改金额和方向
        resp = await client.put(
            f"/entries/{entry_id}",
            json={
                "amount": 2000,
                "from_account_id": bank_id,
                "to_account_id": cash_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == entry_id
        total_debit = sum(float(l["debit_amount"]) for l in data["lines"])
        assert total_debit == pytest.approx(2000)

    @pytest.mark.asyncio
    async def test_edit_only_metadata_lines_unchanged(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """仅更新元数据（兼容旧行为），lines 不变"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 30,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]
        original_lines = create_resp.json()["lines"]

        resp = await client.put(
            f"/entries/{entry_id}",
            json={"description": "更新摘要", "note": "加个备注"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "更新摘要"
        assert data["note"] == "加个备注"
        # lines ID 不变（未重建）
        updated_line_ids = {l["id"] for l in data["lines"]}
        original_line_ids = {l["id"] for l in original_lines}
        assert updated_line_ids == original_line_ids

    @pytest.mark.asyncio
    async def test_edit_nonexistent_account_404(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """传入不存在的科目 ID → 404"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 20,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        resp = await client.put(
            f"/entries/{entry_id}",
            json={
                "amount": 30,
                "category_account_id": "nonexistent-id",
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_edit_id_and_created_at_preserved(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑后分录 ID 和 created_at 不变，updated_at 更新"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 10,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        original = create_resp.json()

        resp = await client.put(
            f"/entries/{original['id']}",
            json={
                "amount": 99,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
                "entry_date": "2025-07-01",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == original["id"]
        assert data["created_at"] == original["created_at"]
        assert data["entry_date"] == "2025-07-01"

    @pytest.mark.asyncio
    async def test_detail_response_includes_account_type(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """分录详情 API 返回 account_type 字段"""
        food_id = await _get_account_id(client, test_book.id, "5001", auth_headers)
        cash_id = await _get_account_id(client, test_book.id, "1001", auth_headers)

        create_resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "expense",
                "entry_date": "2025-06-15",
                "amount": 15,
                "category_account_id": food_id,
                "payment_account_id": cash_id,
            },
            headers=auth_headers,
        )
        entry_id = create_resp.json()["id"]

        resp = await client.get(f"/entries/{entry_id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        for line in data["lines"]:
            assert "account_type" in line
            assert line["account_type"] in ("asset", "liability", "equity", "income", "expense")
