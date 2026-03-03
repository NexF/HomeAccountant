"""v0.4.7 端到端集成测试 — 简化对账机制

验证清单：
  1. 数据迁移验证（pending → confirmed/reconciled）
  2. 端到端：余额快照 → 自动调节分录生成（指定科目 / 默认科目）
  3. 用户手动对账 → Toast 相关字段正确
  4. Dashboard 无 pending 入口（已删除 API 返回 404）
  5. 已删除 API 返回 404
  6. 台账页对账调节分录正常显示
"""

import sqlite3
import shutil
import tempfile
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.models.book import Book


# ============ 辅助函数 ============


async def _get_account_id(client, book_id, code, headers):
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


async def _create_entry(client, book_id, headers, amount, debit_id, credit_id, entry_type="income", description="test"):
    """创建一笔分录（income: debit_id=payment, credit_id=category）"""
    if entry_type in ("income", "expense"):
        resp = await client.post(
            f"/books/{book_id}/entries",
            json={
                "entry_type": entry_type,
                "entry_date": "2025-06-01T10:00:00",
                "description": description,
                "amount": amount,
                "payment_account_id": debit_id,
                "category_account_id": credit_id,
            },
            headers=headers,
        )
    else:
        resp = await client.post(
            f"/books/{book_id}/entries",
            json={
                "entry_type": "manual",
                "entry_date": "2025-06-01T10:00:00",
                "description": description,
                "lines": [
                    {"account_id": debit_id, "debit_amount": amount, "credit_amount": 0},
                    {"account_id": credit_id, "debit_amount": 0, "credit_amount": amount},
                ],
            },
            headers=headers,
        )
    return resp


# ============ 1. 数据迁移验证 ============


class TestDataMigration:
    """验证 migrate_v047_reconciliation.py 迁移脚本正确性"""

    def _create_test_db(self, db_path: Path):
        """创建一个包含 reconciliation_status 列的旧版数据库"""
        conn = sqlite3.connect(str(db_path))
        c = conn.cursor()

        c.execute("""
            CREATE TABLE journal_entries (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                entry_date TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                description TEXT,
                reconciliation_status TEXT DEFAULT 'confirmed',
                source TEXT DEFAULT 'manual',
                external_id TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        c.execute("CREATE INDEX ix_journal_entries_book_id ON journal_entries(book_id)")
        c.execute("CREATE INDEX ix_journal_entries_book_date ON journal_entries(book_id, entry_date)")
        c.execute("CREATE INDEX ix_journal_entries_book_type ON journal_entries(book_id, entry_type)")
        c.execute("CREATE INDEX ix_journal_entries_entry_date ON journal_entries(entry_date)")
        c.execute(
            "CREATE INDEX ix_journal_entries_book_reconciliation "
            "ON journal_entries(book_id, reconciliation_status)"
        )

        # 插入测试数据：3 条 pending + 2 条 confirmed
        for i in range(3):
            c.execute(
                "INSERT INTO journal_entries (id, book_id, user_id, entry_date, entry_type, reconciliation_status) "
                "VALUES (?, 'book1', 'user1', '2025-06-01', 'reconciliation', 'pending')",
                (f"entry-pending-{i}",),
            )
        for i in range(2):
            c.execute(
                "INSERT INTO journal_entries (id, book_id, user_id, entry_date, entry_type, reconciliation_status) "
                "VALUES (?, 'book1', 'user1', '2025-06-01', 'expense', 'confirmed')",
                (f"entry-confirmed-{i}",),
            )

        c.execute("""
            CREATE TABLE balance_snapshots (
                id TEXT PRIMARY KEY,
                data_source_id TEXT,
                account_id TEXT,
                snapshot_date TEXT,
                external_balance REAL,
                book_balance REAL,
                difference REAL,
                status TEXT DEFAULT 'balanced',
                reconciliation_entry_id TEXT,
                created_at TEXT
            )
        """)

        # 插入 pending 快照
        for i in range(2):
            c.execute(
                "INSERT INTO balance_snapshots (id, data_source_id, account_id, snapshot_date, "
                "external_balance, book_balance, difference, status) "
                "VALUES (?, 'ds1', 'acct1', '2025-06-01', 100, 90, 10, 'pending')",
                (f"snap-pending-{i}",),
            )
        c.execute(
            "INSERT INTO balance_snapshots (id, data_source_id, account_id, snapshot_date, "
            "external_balance, book_balance, difference, status) "
            "VALUES ('snap-reconciled-0', 'ds1', 'acct1', '2025-06-01', 100, 100, 0, 'reconciled')"
        )

        conn.commit()
        conn.close()

    def test_migration_pending_to_confirmed(self):
        """pending 分录 → confirmed，pending 快照 → reconciled"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            self._create_test_db(db_path)

            # 运行迁移
            from scripts.migrate_v047_reconciliation import migrate
            migrate(db_path, dry_run=False)

            # 验证
            conn = sqlite3.connect(str(db_path))
            c = conn.cursor()

            # journal_entries 不应再有 reconciliation_status 列
            c.execute("PRAGMA table_info(journal_entries)")
            cols = {row[1] for row in c.fetchall()}
            assert "reconciliation_status" not in cols

            # 所有分录应保留
            c.execute("SELECT COUNT(*) FROM journal_entries")
            assert c.fetchone()[0] == 5

            # balance_snapshots pending → reconciled
            c.execute("SELECT COUNT(*) FROM balance_snapshots WHERE status = 'pending'")
            assert c.fetchone()[0] == 0

            c.execute("SELECT COUNT(*) FROM balance_snapshots WHERE status = 'reconciled'")
            assert c.fetchone()[0] == 3  # 2 原 pending + 1 原 reconciled

            conn.close()

    def test_migration_idempotent(self):
        """迁移是幂等的 — 多次运行不会出错"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            self._create_test_db(db_path)

            from scripts.migrate_v047_reconciliation import migrate
            migrate(db_path, dry_run=False)
            # 第二次运行应不报错
            migrate(db_path, dry_run=False)

            conn = sqlite3.connect(str(db_path))
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM journal_entries")
            assert c.fetchone()[0] == 5
            conn.close()

    def test_migration_dry_run(self):
        """dry-run 不修改数据"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            self._create_test_db(db_path)

            from scripts.migrate_v047_reconciliation import migrate
            migrate(db_path, dry_run=True)

            # reconciliation_status 应仍然存在
            conn = sqlite3.connect(str(db_path))
            c = conn.cursor()
            c.execute("PRAGMA table_info(journal_entries)")
            cols = {row[1] for row in c.fetchall()}
            assert "reconciliation_status" in cols

            c.execute("SELECT COUNT(*) FROM journal_entries WHERE reconciliation_status = 'pending'")
            assert c.fetchone()[0] == 3
            conn.close()

    def test_migration_creates_backup(self):
        """迁移自动创建备份"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            self._create_test_db(db_path)

            from scripts.migrate_v047_reconciliation import migrate
            migrate(db_path, dry_run=False)

            backups = list(Path(tmpdir).glob("test.bak_v047*"))
            assert len(backups) >= 1

    def test_migration_rollback(self):
        """回滚恢复到迁移前状态"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            self._create_test_db(db_path)

            # 先记录原始 hash
            original_data = db_path.read_bytes()

            from scripts.migrate_v047_reconciliation import migrate, find_backup
            migrate(db_path, dry_run=False)

            # 验证迁移后数据变化
            migrated_data = db_path.read_bytes()
            assert migrated_data != original_data

            # 手动回滚（不能用交互式 rollback，直接 copy）
            backup = find_backup(db_path)
            assert backup is not None
            shutil.copy2(backup, db_path)

            # 验证回滚后 reconciliation_status 恢复
            conn = sqlite3.connect(str(db_path))
            c = conn.cursor()
            c.execute("PRAGMA table_info(journal_entries)")
            cols = {row[1] for row in c.fetchall()}
            assert "reconciliation_status" in cols
            conn.close()


# ============ 2. 端到端：余额快照 → 调节分录 ============


class TestE2ESnapshotReconciliation:
    """完整端到端流程：提交余额快照 → 自动生成调节分录"""

    @pytest.mark.asyncio
    async def test_balanced_no_entry_created(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额一致 → 不生成调节分录，status=balanced"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "balanced"
        assert data["difference"] == pytest.approx(0, abs=0.01)

        # 确认未生成调节分录
        entries_resp = await client.get(
            f"/books/{test_book.id}/entries",
            params={"entry_type": "reconciliation"},
            headers=auth_headers,
        )
        assert entries_resp.status_code == 200
        entries_data = entries_resp.json()
        items = entries_data.get("items", entries_data) if isinstance(entries_data, dict) else entries_data
        reconciliation_entries = [
            e for e in (items if isinstance(items, list) else [])
            if e.get("entry_type") == "reconciliation"
        ]
        assert len(reconciliation_entries) == 0

    @pytest.mark.asyncio
    async def test_difference_default_account_creates_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """差异存在 + 未指定调账科目 → 使用系统默认科目生成调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "reconciled"
        assert data["difference"] == pytest.approx(500, abs=0.01)  # 500 - 0 = 500

        # 验证调节分录确实生成
        entries_resp = await client.get(
            f"/books/{test_book.id}/entries",
            headers=auth_headers,
        )
        assert entries_resp.status_code == 200
        entries_data = entries_resp.json()
        items = entries_data.get("items", entries_data) if isinstance(entries_data, dict) else entries_data
        if isinstance(items, list):
            reconciliation_entries = [e for e in items if e.get("entry_type") == "reconciliation"]
            assert len(reconciliation_entries) >= 1

    @pytest.mark.asyncio
    async def test_difference_specified_account_creates_entry(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """差异存在 + 指定调账科目 → 使用指定科目生成调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        income_id = await _get_account_id(client, test_book.id, "4005", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 800, "adjust_account_id": income_id},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "reconciled"
        assert data["difference"] == pytest.approx(800, abs=0.01)

    @pytest.mark.asyncio
    async def test_negative_difference_default_expense_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """实际余额 < 账面余额 → 使用默认费用科目（5099）"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        income_id = await _get_account_id(client, test_book.id, "4001", auth_headers)

        # 先记一笔收入让账面有余额
        entry_resp = await _create_entry(client, test_book.id, auth_headers, 1000, cash_id, income_id, "income", "初始余额")
        assert entry_resp.status_code == 201, f"创建分录失败: {entry_resp.text}"

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500, "snapshot_date": "2025-06-15"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "reconciled"
        assert data["difference"] == pytest.approx(-500, abs=0.01)

    @pytest.mark.asyncio
    async def test_invalid_adjust_account_returns_error(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """无效的调账科目 → 报错"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500, "adjust_account_id": "nonexistent-id"},
            headers=auth_headers,
        )
        assert resp.status_code in (400, 404)

    @pytest.mark.asyncio
    async def test_snapshot_nonexistent_account(
        self, client: AsyncClient, auth_headers
    ):
        """不存在的科目 → 404"""
        resp = await client.post(
            "/accounts/nonexistent/snapshot",
            json={"external_balance": 100},
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ============ 3. 手动对账 Toast 验证 ============


class TestManualReconciliation:
    """用户手动对账（科目详情页 / 资产负债表）→ 返回正确的状态字段"""

    @pytest.mark.asyncio
    async def test_balanced_toast_fields(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额一致时返回 balanced 状态"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0},
            headers=auth_headers,
        )
        data = resp.json()
        assert data["status"] == "balanced"
        assert "snapshot_id" in data
        assert data["account_name"] != ""

    @pytest.mark.asyncio
    async def test_reconciled_toast_fields(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """有差异时返回 reconciled 状态 + 差异金额"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 123.45},
            headers=auth_headers,
        )
        data = resp.json()
        assert data["status"] == "reconciled"
        assert data["difference"] != 0
        assert "snapshot_id" in data
        # SnapshotResponse 不再包含 reconciliation_entry_id
        assert "reconciliation_entry_id" not in data

    @pytest.mark.asyncio
    async def test_snapshot_with_specific_date(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定快照日期 → 响应日期匹配"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)
        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0, "snapshot_date": "2025-06-01"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["snapshot_date"] == "2025-06-01"


# ============ 4 & 5. 已删除 API 返回 404 ============


class TestDeletedEndpoints:
    """Dashboard 无 pending 入口 + 已删除 API 返回 404/405"""

    @pytest.mark.asyncio
    async def test_pending_reconciliations_gone(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """GET /books/{id}/pending-reconciliations → 404/405"""
        resp = await client.get(
            f"/books/{test_book.id}/pending-reconciliations",
            headers=auth_headers,
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_pending_count_gone(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """GET /books/{id}/pending-count → 404/405"""
        resp = await client.get(
            f"/books/{test_book.id}/pending-count",
            headers=auth_headers,
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_confirm_endpoint_gone(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """POST /books/{id}/confirm-reconciliation → 404/405"""
        resp = await client.post(
            f"/books/{test_book.id}/confirm-reconciliation",
            json={"entry_id": "fake"},
            headers=auth_headers,
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_split_endpoint_gone(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """POST /books/{id}/split-reconciliation → 404/405"""
        resp = await client.post(
            f"/books/{test_book.id}/split-reconciliation",
            json={"entry_id": "fake", "items": []},
            headers=auth_headers,
        )
        assert resp.status_code in (404, 405)


# ============ 6. 台账页调节分录正常显示 ============


class TestLedgerReconciliationEntries:
    """对账调节分录在台账页（entries list）中正常显示"""

    @pytest.mark.asyncio
    async def test_reconciliation_entry_in_entries_list(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """生成调节分录后，可在 entries 列表中查到"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        # 提交快照产生差异
        snap_resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 999.99},
            headers=auth_headers,
        )
        assert snap_resp.status_code == 201
        assert snap_resp.json()["status"] == "reconciled"

        # 查询 entries 列表
        entries_resp = await client.get(
            f"/books/{test_book.id}/entries",
            headers=auth_headers,
        )
        assert entries_resp.status_code == 200
        entries_data = entries_resp.json()
        items = entries_data.get("items", [])

        recon_entries = [e for e in items if e.get("entry_type") == "reconciliation"]
        assert len(recon_entries) >= 1

        entry = recon_entries[0]
        assert entry.get("source") == "reconciliation"
        assert "余额调节" in entry.get("description", "")

        # 通过详情 API 获取行项目
        detail_resp = await client.get(
            f"/entries/{entry['id']}",
            headers=auth_headers,
        )
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        lines = detail.get("lines", [])
        assert len(lines) >= 2

    @pytest.mark.asyncio
    async def test_reconciliation_entry_has_correct_amounts(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """调节分录的借贷金额与差异一致"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        snap_resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 250.50},
            headers=auth_headers,
        )
        assert snap_resp.status_code == 201
        data = snap_resp.json()
        expected_diff = abs(data["difference"])

        # 查询 entries 列表
        entries_resp = await client.get(
            f"/books/{test_book.id}/entries",
            headers=auth_headers,
        )
        entries_data = entries_resp.json()
        items = entries_data.get("items", [])

        recon_entries = [e for e in items if e.get("entry_type") == "reconciliation"]
        assert len(recon_entries) >= 1

        # 通过详情 API 获取行项目
        detail_resp = await client.get(
            f"/entries/{recon_entries[0]['id']}",
            headers=auth_headers,
        )
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        lines = detail.get("lines", [])

        total_debit = sum(float(l.get("debit_amount", 0)) for l in lines)
        total_credit = sum(float(l.get("credit_amount", 0)) for l in lines)

        # 借贷平衡
        assert total_debit == pytest.approx(total_credit, abs=0.01)
        # 金额与差异一致
        assert total_debit == pytest.approx(expected_diff, abs=0.01)

    @pytest.mark.asyncio
    async def test_multiple_snapshots_create_independent_entries(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """多次快照生成独立的调节分录"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp1 = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 100},
            headers=auth_headers,
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 300},
            headers=auth_headers,
        )
        assert resp2.status_code == 201

        entries_resp = await client.get(
            f"/books/{test_book.id}/entries",
            headers=auth_headers,
        )
        entries_data = entries_resp.json()
        items = entries_data.get("items", entries_data) if isinstance(entries_data, dict) else entries_data

        if isinstance(items, list):
            recon_entries = [e for e in items if e.get("entry_type") == "reconciliation"]
            assert len(recon_entries) >= 2
