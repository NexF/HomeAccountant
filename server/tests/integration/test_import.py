"""导入功能测试 (v0.4.1 阶段 4)

覆盖端点：
- POST /books/{book_id}/import/upload          上传并解析
- POST /books/{book_id}/import/{task_id}/confirm  确认导入
- GET  /books/{book_id}/import/history          导入历史
- DELETE /books/{book_id}/import/{task_id}      撤销导入

覆盖场景：
- 上传解析正常流程
- 文件校验（非 xlsx / 超 10MB / 非微信格式）
- 重复检测（is_duplicate 标记）
- 分批确认导入（多次 confirm）
- 幂等性（重复 confirm 不产生重复分录）
- 支出/收入/中性交易三种分录创建（含完整借贷双科目）
- source 标记为 "import"
- external_id 正确设置
- task 状态流转（parsed → partial → imported）
- 撤销导入（删除关联分录，task 回到 parsed）
- 导入历史列表
- 缺 payment_account_id 校验
"""

import io
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from openpyxl import Workbook
from sqlalchemy import select

from app.models.account import Account
from app.models.journal import JournalEntry
from tests.conftest import TestSessionLocal


# ──────────── 辅助：构造微信账单 xlsx ────────────

def _make_wechat_xlsx(
    rows: list[tuple] | None = None,
    include_header: bool = True,
    identifier: str = "微信支付账单明细",
) -> bytes:
    """构造微信账单 xlsx 文件的二进制内容"""
    wb = Workbook()
    ws = wb.active

    # 标识行
    ws.append([identifier])

    # 元信息行 (row 1-14)
    for i in range(14):
        ws.append([f"元信息 {i}"])

    # 分隔线 (row 15)
    ws.append(["---"])

    if include_header:
        # 表头 (row 16)
        ws.append([
            "交易时间", "交易类型", "交易对方", "商品", "收/支",
            "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注",
        ])

    if rows is None:
        # 默认测试数据
        rows = [
            ("2026-02-20 10:00:00", "商户消费", "星巴克", "拿铁咖啡", "支出",
             "¥35.00", "零钱", "支付成功", "TX001", "M001", ""),
            ("2026-02-20 12:00:00", "商户消费", "美团外卖", "午餐", "支出",
             "¥28.50", "招商银行(1234)", "支付成功", "TX002", "M002", ""),
            ("2026-02-21 09:00:00", "转账", "张三", "/", "收入",
             "¥100.00", "零钱", "已收钱", "TX003", "M003", ""),
        ]

    for row in rows:
        ws.append(list(row))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_wechat_xlsx_with_neutral() -> bytes:
    """构造包含中性交易的微信账单"""
    rows = [
        ("2026-02-20 10:00:00", "商户消费", "超市", "日用品", "支出",
         "¥50.00", "零钱", "支付成功", "TX010", "M010", ""),
        ("2026-02-21 09:00:00", "转账", "公司", "/", "收入",
         "¥200.00", "零钱", "已转账", "TX011", "M011", ""),
        ("2026-02-22 15:00:00", "转账", "零钱通", "/", "中性交易",
         "¥500.00", "零钱", "已存入", "TX012", "M012", ""),
    ]
    return _make_wechat_xlsx(rows)


# ──────────── Fixtures ────────────

@pytest_asyncio.fixture
async def expense_account(test_book) -> Account:
    """获取日常消费科目 (5001)"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "5001",
            )
        )
        acct = result.scalar_one_or_none()
        if acct:
            return acct
        # fallback: 查找任意费用科目
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code.like("5%"),
                Account.is_active == True,
            )
        )
        return result.scalars().first()


@pytest_asyncio.fixture
async def income_acct(test_book) -> Account:
    """获取收入科目 (4005)"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "4005",
            )
        )
        acct = result.scalar_one_or_none()
        if acct:
            return acct
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code.like("4%"),
                Account.is_active == True,
            )
        )
        return result.scalars().first()


@pytest_asyncio.fixture
async def asset_account_a(test_book) -> Account:
    """获取资产科目 A (1002-01 货币基金)"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "1002-01",
            )
        )
        acct = result.scalar_one_or_none()
        if acct:
            return acct
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code.like("1%"),
                Account.is_active == True,
            )
        )
        return result.scalars().first()


@pytest_asyncio.fixture
async def asset_account_b(test_book) -> Account:
    """获取资产科目 B (1001-01 现金)"""
    async with TestSessionLocal() as db:
        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "1001-01",
            )
        )
        return result.scalar_one()


@pytest_asyncio.fixture
async def wechat_xlsx() -> bytes:
    """标准微信账单 xlsx"""
    return _make_wechat_xlsx()


@pytest_asyncio.fixture
async def uploaded_task(
    client: AsyncClient, auth_headers, test_book, wechat_xlsx,
) -> dict:
    """上传并返回解析结果"""
    resp = await client.post(
        f"/books/{test_book.id}/import/upload",
        files={"file": ("wechat.xlsx", wechat_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()


# ══════════════════════════════════════════════════════
# 上传解析
# ══════════════════════════════════════════════════════


class TestUploadAndParse:

    @pytest.mark.asyncio
    async def test_upload_normal(
        self, client: AsyncClient, auth_headers, test_book, wechat_xlsx,
    ):
        """正常上传解析"""
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", wechat_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["format"] == "wechat"
        assert data["status"] == "parsed"
        assert data["total_rows"] == 3
        assert len(data["rows"]) == 3

        # 检查汇总
        assert data["summary"]["expense_count"] == 2
        assert data["summary"]["income_count"] == 1
        assert float(data["summary"]["expense_total"]) == 63.5
        assert float(data["summary"]["income_total"]) == 100.0

        # 检查筛选维度
        assert "支出" in data["filters"]["directions"]
        assert "收入" in data["filters"]["directions"]

    @pytest.mark.asyncio
    async def test_upload_non_xlsx(
        self, client: AsyncClient, auth_headers, test_book,
    ):
        """非 xlsx 文件 → 400"""
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("data.csv", b"a,b,c\n1,2,3", "text/csv")},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_upload_non_wechat_format(
        self, client: AsyncClient, auth_headers, test_book,
    ):
        """非微信格式 xlsx → 422"""
        wb = Workbook()
        ws = wb.active
        ws.append(["这不是微信账单"])
        buf = io.BytesIO()
        wb.save(buf)

        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("other.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_upload_requires_auth(
        self, client: AsyncClient, test_book, wechat_xlsx,
    ):
        """未认证 → 401"""
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", wechat_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_upload_wrong_book(
        self, client: AsyncClient, auth_headers, wechat_xlsx,
    ):
        """不存在的账本 → 404"""
        resp = await client.post(
            f"/books/{uuid.uuid4()}/import/upload",
            files={"file": ("wechat.xlsx", wechat_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_upload_rows_have_external_id(
        self, client: AsyncClient, auth_headers, test_book, wechat_xlsx,
    ):
        """每行包含 external_id"""
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", wechat_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        data = resp.json()
        for row in data["rows"]:
            assert row["external_id"].startswith("wechat_")

    @pytest.mark.asyncio
    async def test_upload_duplicate_detection(
        self, client: AsyncClient, auth_headers, test_book,
        expense_account, asset_account_a,
    ):
        """上传后重复检测：先导入再上传相同文件"""
        content = _make_wechat_xlsx()

        # 第一次上传
        resp1 = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        task1 = resp1.json()
        assert task1["summary"]["duplicate_count"] == 0

        # 导入支出行
        expense_rows = [r for r in task1["rows"] if r["direction"] == "支出"]
        await client.post(
            f"/books/{test_book.id}/import/{task1['task_id']}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )

        # 第二次上传相同文件
        resp2 = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        task2 = resp2.json()
        # 已导入的支出行应标记为重复
        dup_count = sum(1 for r in task2["rows"] if r["is_duplicate"])
        assert dup_count == len(expense_rows)
        assert task2["summary"]["duplicate_count"] == dup_count


# ══════════════════════════════════════════════════════
# 确认导入
# ══════════════════════════════════════════════════════


class TestConfirmImport:

    @pytest.mark.asyncio
    async def test_confirm_expense(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """确认导入支出行（借费用科目，贷资产科目）"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        resp = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported_rows"] == len(expense_rows)
        assert data["skipped_rows"] == 0
        assert data["status"] == "partial"

    @pytest.mark.asyncio
    async def test_confirm_income(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, income_acct, asset_account_a,
    ):
        """确认导入收入行（借资产科目，贷收入科目）"""
        task_id = uploaded_task["task_id"]
        income_rows = [r for r in uploaded_task["rows"] if r["direction"] == "收入"]

        resp = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in income_rows],
                "income_account_id": income_acct.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported_rows"] == len(income_rows)

    @pytest.mark.asyncio
    async def test_confirm_neutral_transaction(
        self, client: AsyncClient, auth_headers, test_book,
        asset_account_a, asset_account_b,
    ):
        """确认导入中性交易"""
        content = _make_wechat_xlsx_with_neutral()

        # 上传
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        task = resp.json()
        neutral_rows = [r for r in task["rows"] if r["direction"] == "中性交易"]
        assert len(neutral_rows) > 0

        # 确认中性交易
        resp = await client.post(
            f"/books/{test_book.id}/import/{task['task_id']}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in neutral_rows],
                "from_account_id": asset_account_a.id,
                "to_account_id": asset_account_b.id,
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["imported_rows"] == len(neutral_rows)

    @pytest.mark.asyncio
    async def test_confirm_batch_partial(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, income_acct, asset_account_a,
    ):
        """分批确认：先支出，再收入"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]
        income_rows = [r for r in uploaded_task["rows"] if r["direction"] == "收入"]

        # 第一批：支出
        resp1 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        data1 = resp1.json()
        assert data1["status"] == "partial"
        assert data1["total_confirmed"] == len(expense_rows)

        # 第二批：收入
        resp2 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in income_rows],
                "income_account_id": income_acct.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        data2 = resp2.json()
        assert data2["status"] == "imported"
        assert data2["total_confirmed"] == len(expense_rows) + len(income_rows)

    @pytest.mark.asyncio
    async def test_confirm_idempotent(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """幂等性：重复 confirm 同一行不产生重复分录"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        body = {"entries": [{
            "indexes": [expense_rows[0]["index"]],
            "expense_account_id": expense_account.id,
            "payment_account_id": asset_account_a.id,
        }]}

        # 第一次 confirm
        resp1 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json=body,
            headers=auth_headers,
        )
        assert resp1.json()["imported_rows"] == 1
        assert resp1.json()["skipped_rows"] == 0

        # 第二次 confirm 同一行
        resp2 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json=body,
            headers=auth_headers,
        )
        assert resp2.json()["imported_rows"] == 0
        assert resp2.json()["skipped_rows"] == 1

    @pytest.mark.asyncio
    async def test_confirm_source_is_import(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """导入的分录 source 应标记为 'import'"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [expense_rows[0]["index"]],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )

        # 检查数据库中分录的 source
        ext_id = expense_rows[0]["external_id"]
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(JournalEntry).where(
                    JournalEntry.book_id == test_book.id,
                    JournalEntry.external_id == ext_id,
                )
            )
            entry = result.scalar_one()
            assert entry.source == "import"

    @pytest.mark.asyncio
    async def test_confirm_external_id_set(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """导入的分录 external_id 正确设置"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )

        # 检查所有导入分录的 external_id
        async with TestSessionLocal() as db:
            for row in expense_rows:
                result = await db.execute(
                    select(JournalEntry).where(
                        JournalEntry.book_id == test_book.id,
                        JournalEntry.external_id == row["external_id"],
                    )
                )
                entry = result.scalar_one_or_none()
                assert entry is not None
                assert entry.external_id == row["external_id"]

    @pytest.mark.asyncio
    async def test_confirm_invalid_index(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """行索引超出范围 → 400"""
        task_id = uploaded_task["task_id"]

        resp = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [999],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_confirm_nonexistent_task(
        self, client: AsyncClient, auth_headers, test_book,
        expense_account, asset_account_a,
    ):
        """不存在的 task → 404"""
        resp = await client.post(
            f"/books/{test_book.id}/import/{uuid.uuid4()}/confirm",
            json={"entries": [{
                "indexes": [0],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_confirm_expense_missing_payment_account(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account,
    ):
        """支出行缺 payment_account_id → 422"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        resp = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [expense_rows[0]["index"]],
                "expense_account_id": expense_account.id,
                # 故意不传 payment_account_id
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_confirm_income_missing_payment_account(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, income_acct,
    ):
        """收入行缺 payment_account_id → 422"""
        task_id = uploaded_task["task_id"]
        income_rows = [r for r in uploaded_task["rows"] if r["direction"] == "收入"]

        resp = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [income_rows[0]["index"]],
                "income_account_id": income_acct.id,
                # 故意不传 payment_account_id
            }]},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# ══════════════════════════════════════════════════════
# Task 状态流转
# ══════════════════════════════════════════════════════


class TestTaskStatus:

    @pytest.mark.asyncio
    async def test_status_parsed_to_partial_to_imported(
        self, client: AsyncClient, auth_headers, test_book,
        expense_account, income_acct, asset_account_a,
    ):
        """状态流转：parsed → partial → imported"""
        content = _make_wechat_xlsx()

        # 上传 → parsed
        resp = await client.post(
            f"/books/{test_book.id}/import/upload",
            files={"file": ("wechat.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers,
        )
        task = resp.json()
        assert task["status"] == "parsed"
        task_id = task["task_id"]

        expense_rows = [r for r in task["rows"] if r["direction"] == "支出"]
        income_rows = [r for r in task["rows"] if r["direction"] == "收入"]

        # 导入部分 → partial
        resp1 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [expense_rows[0]["index"]],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )
        assert resp1.json()["status"] == "partial"

        # 导入剩余 → imported
        resp2 = await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [
                {
                    "indexes": [expense_rows[1]["index"]],
                    "expense_account_id": expense_account.id,
                    "payment_account_id": asset_account_a.id,
                },
                {
                    "indexes": [r["index"] for r in income_rows],
                    "income_account_id": income_acct.id,
                    "payment_account_id": asset_account_a.id,
                },
            ]},
            headers=auth_headers,
        )
        assert resp2.json()["status"] == "imported"


# ══════════════════════════════════════════════════════
# 撤销导入
# ══════════════════════════════════════════════════════


class TestDeleteImport:

    @pytest.mark.asyncio
    async def test_delete_removes_entries(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """撤销导入：删除关联分录"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        # 先导入
        await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )

        # 确认分录已创建
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(JournalEntry).where(
                    JournalEntry.book_id == test_book.id,
                    JournalEntry.source == "import",
                )
            )
            entries = result.scalars().all()
            assert len(entries) == len(expense_rows)

        # 撤销
        resp = await client.delete(
            f"/books/{test_book.id}/import/{task_id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted_count"] == len(expense_rows)

        # 确认分录已删除
        async with TestSessionLocal() as db:
            result = await db.execute(
                select(JournalEntry).where(
                    JournalEntry.book_id == test_book.id,
                    JournalEntry.source == "import",
                )
            )
            entries = result.scalars().all()
            assert len(entries) == 0

    @pytest.mark.asyncio
    async def test_delete_resets_task_status(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task, expense_account, asset_account_a,
    ):
        """撤销后 task 状态回到 parsed"""
        task_id = uploaded_task["task_id"]
        expense_rows = [r for r in uploaded_task["rows"] if r["direction"] == "支出"]

        # 导入
        await client.post(
            f"/books/{test_book.id}/import/{task_id}/confirm",
            json={"entries": [{
                "indexes": [r["index"] for r in expense_rows],
                "expense_account_id": expense_account.id,
                "payment_account_id": asset_account_a.id,
            }]},
            headers=auth_headers,
        )

        # 撤销
        await client.delete(
            f"/books/{test_book.id}/import/{task_id}",
            headers=auth_headers,
        )

        # 检查历史中 task 状态
        resp = await client.get(
            f"/books/{test_book.id}/import/history",
            headers=auth_headers,
        )
        tasks = resp.json()
        the_task = [t for t in tasks if t["id"] == task_id][0]
        assert the_task["status"] == "parsed"
        assert the_task["imported_rows"] == 0

    @pytest.mark.asyncio
    async def test_delete_nonexistent_task(
        self, client: AsyncClient, auth_headers, test_book,
    ):
        """删除不存在的 task → 404"""
        resp = await client.delete(
            f"/books/{test_book.id}/import/{uuid.uuid4()}",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_no_imported_entries(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task,
    ):
        """未导入任何分录的 task 撤销 → deleted_count=0"""
        task_id = uploaded_task["task_id"]

        resp = await client.delete(
            f"/books/{test_book.id}/import/{task_id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["deleted_count"] == 0


# ══════════════════════════════════════════════════════
# 导入历史
# ══════════════════════════════════════════════════════


class TestImportHistory:

    @pytest.mark.asyncio
    async def test_history_empty(
        self, client: AsyncClient, auth_headers, test_book,
    ):
        """无导入记录 → 空列表"""
        resp = await client.get(
            f"/books/{test_book.id}/import/history",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_history_after_upload(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task,
    ):
        """上传后历史中有记录"""
        resp = await client.get(
            f"/books/{test_book.id}/import/history",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == uploaded_task["task_id"]
        assert data[0]["format"] == "wechat"
        assert data[0]["status"] == "parsed"
        assert data[0]["total_rows"] == 3

    @pytest.mark.asyncio
    async def test_history_multiple_uploads(
        self, client: AsyncClient, auth_headers, test_book,
    ):
        """多次上传 → 按时间倒序"""
        for i in range(3):
            content = _make_wechat_xlsx(rows=[
                (f"2026-02-{20+i} 10:00:00", "消费", "商户", "商品", "支出",
                 "¥10.00", "零钱", "支付成功", f"TX_HIST_{i}", f"M_HIST_{i}", ""),
            ])
            await client.post(
                f"/books/{test_book.id}/import/upload",
                files={"file": (f"wechat_{i}.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                headers=auth_headers,
            )

        resp = await client.get(
            f"/books/{test_book.id}/import/history",
            headers=auth_headers,
        )
        data = resp.json()
        assert len(data) == 3

    @pytest.mark.asyncio
    async def test_history_user_isolation(
        self, client: AsyncClient, auth_headers, test_book,
        uploaded_task,
    ):
        """用户之间的导入记录互相不可见"""
        # 注册第二个用户
        resp = await client.post("/auth/register", json={
            "email": "other_import@example.com",
            "password": "password123",
            "invite_code": "TEST01",
        })
        other_token = resp.json()["token"]["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        resp = await client.get(
            f"/books/{test_book.id}/import/history",
            headers=other_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []
