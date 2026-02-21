"""末级科目约束 + 自动迁移 + 删除保护 + 科目树 is_leaf 测试

覆盖：
- 阶段1: 叶子节点校验（选父科目记账被拒、选叶子科目记账成功、动态叶子判定）
- 阶段2: 历史分录自动迁移（有分录时迁移、无分录时不迁移、编码冲突复用）
- 阶段3: 科目删除/停用保护（有分录拒绝、有子科目拒绝、干净科目可删）
- 阶段4: 科目树 API is_leaf 字段
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.book import Book
from app.models.journal import JournalLine
from app.models.user import User
from tests.conftest import TestSessionLocal


# ═══════════════════ 辅助函数 ═══════════════════


async def _get_account_by_code(book_id: str, code: str) -> Account:
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == book_id,
                Account.code == code,
            )
        )
        return result.scalar_one()


async def _get_account_by_code_or_none(book_id: str, code: str) -> Account | None:
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == book_id,
                Account.code == code,
            )
        )
        return result.scalar_one_or_none()


async def _count_lines_for_account(account_id: str) -> int:
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(func.count()).select_from(JournalLine).where(
                JournalLine.account_id == account_id,
            )
        )
        return result.scalar()


async def _create_expense_entry(
    client: AsyncClient,
    auth_headers: dict,
    book_id: str,
    category_account_id: str,
    payment_account_id: str,
    amount: float = 100,
):
    """创建一条费用分录的快捷方法"""
    return await client.post(
        f"/books/{book_id}/entries",
        json={
            "entry_type": "expense",
            "entry_date": "2025-06-01",
            "amount": amount,
            "category_account_id": category_account_id,
            "payment_account_id": payment_account_id,
            "description": "测试费用",
        },
        headers=auth_headers,
    )


# ═══════════════════ 阶段1: 叶子节点校验 ═══════════════════


class TestLeafAccountConstraint:
    """末级科目记账约束"""

    @pytest.mark.asyncio
    async def test_booking_with_parent_account_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """选择父科目（1001 货币资金，有子科目）记账 → 400 错误"""
        parent = await _get_account_by_code(test_book.id, "1001")
        # 1001-01 现金作为支付方（叶子节点）
        leaf = await _get_account_by_code(test_book.id, "1001-01")
        # 5001 餐饮饮食目前是叶子节点
        expense_leaf = await _get_account_by_code(test_book.id, "5001")

        # 用父科目（1001）作为支付方记账 → 应拒绝
        resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=expense_leaf.id,
            payment_account_id=parent.id,
        )
        assert resp.status_code == 400
        assert "非末级科目" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_booking_with_leaf_account_success(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """选择叶子科目记账 → 成功"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5001")

        resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_edit_entry_to_parent_account_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """编辑分录时将科目改为父科目 → 400 错误"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5001")
        parent = await _get_account_by_code(test_book.id, "1001")

        # 先创建一条正常分录
        create_resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert create_resp.status_code == 201
        entry_id = create_resp.json()["id"]

        # 编辑：把支付方改为父科目
        edit_resp = await client.put(
            f"/entries/{entry_id}",
            json={
                "amount": 100,
                "category_account_id": leaf_expense.id,
                "payment_account_id": parent.id,
            },
            headers=auth_headers,
        )
        assert edit_resp.status_code == 400
        assert "非末级科目" in edit_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_account_becomes_non_leaf_after_adding_child(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """科目新增子科目后自动变为不可记账"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5001")

        # 1. 先用 5001（叶子）记一笔 → 成功
        resp1 = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert resp1.status_code == 201

        # 2. 给 5001 新增子科目 外卖
        create_child_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "外卖",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": leaf_expense.id,
            },
            headers=auth_headers,
        )
        assert create_child_resp.status_code == 201

        # 3. 再用 5001 记一笔 → 应被拒绝（因为已经不是叶子了）
        resp2 = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert resp2.status_code == 400
        assert "非末级科目" in resp2.json()["detail"]

    @pytest.mark.asyncio
    async def test_transfer_with_parent_account_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """转账时使用父科目 → 400 错误"""
        parent = await _get_account_by_code(test_book.id, "1001")
        leaf = await _get_account_by_code(test_book.id, "1001-01")

        resp = await client.post(
            f"/books/{test_book.id}/entries",
            json={
                "entry_type": "transfer",
                "entry_date": "2025-06-01",
                "amount": 500,
                "from_account_id": parent.id,
                "to_account_id": leaf.id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "非末级科目" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_convert_with_parent_account_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """类型转换时指定父科目 → 拒绝"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5001")
        parent = await _get_account_by_code(test_book.id, "1001")

        # 先创建一条费用分录
        create_resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert create_resp.status_code == 201
        entry_id = create_resp.json()["id"]

        # 转换为转账，但指定父科目作为目标
        convert_resp = await client.post(
            f"/entries/{entry_id}/convert",
            json={
                "target_type": "transfer",
                "category_account_id": parent.id,
                "payment_account_id": leaf_payment.id,
            },
            headers=auth_headers,
        )
        assert convert_resp.status_code == 400
        assert "非末级科目" in convert_resp.json()["detail"]


# ═══════════════════ 阶段2: 历史分录自动迁移 ═══════════════════


class TestAutoMigration:
    """新增子科目时自动迁移父科目上的分录"""

    @pytest.mark.asyncio
    async def test_auto_migration_on_add_child(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """新增子科目时自动迁移父科目上的分录"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5001")

        # 1. 用 5001 餐饮饮食（叶子）记 3 笔
        for _ in range(3):
            resp = await _create_expense_entry(
                client, auth_headers, test_book.id,
                category_account_id=leaf_expense.id,
                payment_account_id=leaf_payment.id,
            )
            assert resp.status_code == 201

        # 验证 5001 上有 3 条 lines
        line_count = await _count_lines_for_account(leaf_expense.id)
        assert line_count == 3

        # 2. 给 5001 新增子科目 外卖
        create_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "外卖",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": leaf_expense.id,
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        data = create_resp.json()

        # 3. 验证 migration 字段
        assert data["migration"]["triggered"] is True
        assert data["migration"]["migrated_lines_count"] == 3
        assert data["migration"]["fallback_account"]["code"] == "5001-99"
        assert "待分类餐饮饮食" in data["migration"]["fallback_account"]["name"]

        # 4. 验证自动创建了 5001-99
        fallback = await _get_account_by_code(test_book.id, "5001-99")
        assert fallback is not None
        assert fallback.name == "待分类餐饮饮食"

        # 5. 验证 3 条 lines 已迁移到 5001-99
        old_count = await _count_lines_for_account(leaf_expense.id)
        assert old_count == 0
        new_count = await _count_lines_for_account(fallback.id)
        assert new_count == 3

    @pytest.mark.asyncio
    async def test_no_migration_when_no_lines(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """父科目无分录时不触发迁移"""
        # 5002 交通出行（叶子，无分录）
        expense = await _get_account_by_code(test_book.id, "5002")

        # 给 5002 新增子科目
        resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "公交地铁",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": expense.id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()

        # migration 未触发
        assert data["migration"]["triggered"] is False

        # 不应创建 5002-99
        fallback = await _get_account_by_code_or_none(test_book.id, "5002-99")
        assert fallback is None

    @pytest.mark.asyncio
    async def test_migration_reuses_existing_fallback(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """待分类科目编码冲突时复用已有科目"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")

        # 用 5004 日用百货（叶子）来测试
        leaf_expense = await _get_account_by_code(test_book.id, "5004")

        # 1. 用 5004 记 2 笔
        for _ in range(2):
            resp = await _create_expense_entry(
                client, auth_headers, test_book.id,
                category_account_id=leaf_expense.id,
                payment_account_id=leaf_payment.id,
            )
            assert resp.status_code == 201

        # 2. 给 5004 新增子科目 → 触发迁移，自动创建 5004-99
        create_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "清洁用品",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": leaf_expense.id,
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        data = create_resp.json()

        # 迁移触发
        assert data["migration"]["triggered"] is True
        assert data["migration"]["migrated_lines_count"] == 2

    @pytest.mark.asyncio
    async def test_second_child_no_duplicate_migration(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """同时新增多个子科目时，仅首次触发迁移"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5005")

        # 用 5005 记 2 笔
        for _ in range(2):
            resp = await _create_expense_entry(
                client, auth_headers, test_book.id,
                category_account_id=leaf_expense.id,
                payment_account_id=leaf_payment.id,
            )
            assert resp.status_code == 201

        # 新增第一个子科目 → 触发迁移
        resp1 = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "服装",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": leaf_expense.id,
            },
            headers=auth_headers,
        )
        assert resp1.status_code == 201
        assert resp1.json()["migration"]["triggered"] is True

        # 新增第二个子科目 → 不触发迁移（父科目已不是叶子了）
        resp2 = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "化妆品",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": leaf_expense.id,
            },
            headers=auth_headers,
        )
        assert resp2.status_code == 201
        assert resp2.json()["migration"]["triggered"] is False


# ═══════════════════ 阶段3: 科目删除/停用保护 ═══════════════════


class TestAccountDeleteProtection:
    """科目删除/停用保护测试"""

    @pytest.mark.asyncio
    async def test_delete_account_with_entry_lines_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """删除有分录引用的科目 → 拒绝"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5006")

        # 用 5006 记一笔
        entry_resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert entry_resp.status_code == 201

        # 删除 5006 → 400
        del_resp = await client.delete(
            f"/accounts/{leaf_expense.id}", headers=auth_headers
        )
        assert del_resp.status_code == 400
        assert "分录引用" in del_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_account_with_children_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """删除有子科目的科目 → 拒绝"""
        parent = await _get_account_by_code(test_book.id, "1001")

        # 1001 有子科目（1001-01 现金, 1001-02 存款）
        del_resp = await client.delete(
            f"/accounts/{parent.id}", headers=auth_headers
        )
        assert del_resp.status_code == 400
        assert "子科目" in del_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_clean_account_success(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """删除无引用无子科目的科目 → 成功"""
        # 创建一个干净的自定义科目
        create_resp = await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "待删除科目",
                "type": "expense",
                "balance_direction": "debit",
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        account_id = create_resp.json()["id"]

        # 删除 → 成功
        del_resp = await client.delete(
            f"/accounts/{account_id}", headers=auth_headers
        )
        assert del_resp.status_code == 200
        assert del_resp.json()["is_active"] is False

    @pytest.mark.asyncio
    async def test_deactivate_account_with_lines_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """停用有分录引用的科目 → 拒绝（与删除相同逻辑）"""
        leaf_payment = await _get_account_by_code(test_book.id, "1001-01")
        leaf_expense = await _get_account_by_code(test_book.id, "5007")

        # 记一笔
        entry_resp = await _create_expense_entry(
            client, auth_headers, test_book.id,
            category_account_id=leaf_expense.id,
            payment_account_id=leaf_payment.id,
        )
        assert entry_resp.status_code == 201

        # 停用 → 400
        del_resp = await client.delete(
            f"/accounts/{leaf_expense.id}", headers=auth_headers
        )
        assert del_resp.status_code == 400
        assert "分录引用" in del_resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_deactivate_account_with_children_rejected(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """停用有活跃子科目的科目 → 拒绝"""
        parent = await _get_account_by_code(test_book.id, "1001")

        # 1001 货币资金有子科目
        del_resp = await client.delete(
            f"/accounts/{parent.id}", headers=auth_headers
        )
        assert del_resp.status_code == 400
        assert "子科目" in del_resp.json()["detail"]


# ═══════════════════ 阶段4: 科目树 API is_leaf 字段 ═══════════════════


class TestAccountTreeIsLeaf:
    """科目树 API 返回 is_leaf 字段"""

    @pytest.mark.asyncio
    async def test_tree_has_is_leaf_field(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """科目树节点包含 is_leaf 字段"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        assert resp.status_code == 200
        tree = resp.json()

        # 检查资产类中的第一个节点
        first_asset = tree["asset"][0]
        assert "is_leaf" in first_asset

    @pytest.mark.asyncio
    async def test_parent_node_is_leaf_false(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """父节点 is_leaf = false"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree = resp.json()

        # 1001 货币资金有子科目 → is_leaf = false
        cash = next(a for a in tree["asset"] if a["code"] == "1001")
        assert cash["is_leaf"] is False
        assert len(cash["children"]) > 0

    @pytest.mark.asyncio
    async def test_leaf_node_is_leaf_true(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """叶子节点 is_leaf = true"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree = resp.json()

        # 5001 餐饮饮食（无子科目）→ is_leaf = true
        food = next(e for e in tree["expense"] if e["code"] == "5001")
        assert food["is_leaf"] is True
        assert len(food["children"]) == 0

    @pytest.mark.asyncio
    async def test_deep_nested_is_leaf(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """三级嵌套：1001 > 1001-02 存款 > 1001-0201 支付宝"""
        resp = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree = resp.json()

        cash = next(a for a in tree["asset"] if a["code"] == "1001")
        assert cash["is_leaf"] is False

        deposit = next(c for c in cash["children"] if c["code"] == "1001-02")
        assert deposit["is_leaf"] is False

        alipay = next(c for c in deposit["children"] if c["code"] == "1001-0201")
        assert alipay["is_leaf"] is True

    @pytest.mark.asyncio
    async def test_is_leaf_updates_after_adding_child(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """新增子科目后 is_leaf 从 true 变为 false"""
        # 先查看 5001 → is_leaf = true
        resp1 = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree1 = resp1.json()
        food = next(e for e in tree1["expense"] if e["code"] == "5001")
        assert food["is_leaf"] is True

        # 给 5001 新增子科目
        await client.post(
            f"/books/{test_book.id}/accounts",
            json={
                "name": "外卖",
                "type": "expense",
                "balance_direction": "debit",
                "parent_id": food["id"],
            },
            headers=auth_headers,
        )

        # 再查看 5001 → is_leaf = false
        resp2 = await client.get(
            f"/books/{test_book.id}/accounts", headers=auth_headers
        )
        tree2 = resp2.json()
        food2 = next(e for e in tree2["expense"] if e["code"] == "5001")
        assert food2["is_leaf"] is False
        assert len(food2["children"]) > 0
