# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.7**
> **创建日期：2026-03-02**
> **基于版本：v0.4.6（插件多账本同步）**
> **状态：规划中**
> **本版本变更：取消"待处理对账"功能，余额快照有差异时直接生成已确认的调节分录（使用插件配置的调账科目或系统默认科目）；删除 pending 队列及相关 API/UI**

---

## 1. 技术架构概述

v0.4.7 是一次**简化对账流程 + 增强插件配置**的变更，涉及后端 service 逻辑重写、数据模型清理、数据迁移、前端页面/组件删除与简化、插件端适配。

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：Python FastAPI + SQLAlchemy (async) + SQLite (aiosqlite)

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Model** | `server/app/models/journal.py` | 修改 | 移除 `reconciliation_status` 字段和索引 |
| **Model** | `server/app/models/sync.py` | 修改 | `BalanceSnapshot.status` 枚举简化 |
| **Schema** | `server/app/schemas/sync.py` | 修改 | 删除 pending 相关 schema；`SnapshotCreateRequest` 新增 `adjust_account_id` |
| **Service** | `server/app/services/reconciliation_service.py` | 大改 | 删除 4 个函数；`create_snapshot` 逻辑重写 |
| **Router** | `server/app/routers/sync.py` | 修改 | 删除 4 个端点 |
| **Migration** | `server/scripts/migrate_v047_reconciliation.py` | 新增 | 一次性迁移脚本，含备份和回滚功能 |
| **MCP** | `server/mcp_server/tools/sync.py` | 修改 | `sync_balance` 工具新增 `adjust_account_id` 参数 |
| **MCP** | `server/mcp_server/client.py` | 修改 | `submit_snapshot` 新增 `adjust_account_id` 参数 |
| **Test** | `server/tests/test_sync.py` | 大改 | 删除 pending 相关测试；新增自动调账测试 |
| **前端页面** | `client/app/sync/reconcile.tsx` | 删除 | 待处理对账页面 |
| **前端组件** | `client/features/sync/ReconcileCard.tsx` | 删除 | |
| **前端组件** | `client/features/sync/BalanceCompare.tsx` | 删除 | |
| **前端模块** | `client/features/sync/index.ts` | 删除 | |
| **前端服务** | `client/services/syncService.ts` | 修改 | 删除 4 个方法；`submitSnapshot` 新增参数 |
| **前端页面** | `client/app/(tabs)/index.tsx` | 修改 | 移除 pending 相关逻辑 |
| **前端路由** | `client/app/_layout.tsx` | 修改 | 移除 `sync/reconcile` 路由 |
| **前端页面** | `client/app/accounts/[id].tsx` | 修改 | 对账 toast 简化 |
| **前端组件** | `client/features/account/AccountsPane.tsx` | 修改 | 同上 |
| **前端组件** | `client/features/report/BalanceSheetTable.tsx` | 修改 | 移除跳转链接 |
| **插件** | `plugins/eastmoney_monitor/plugin.py` | 修改 | CONFIG_SCHEMA + 同步逻辑 |
| **插件** | `plugins/longport_monitor/plugin.py` | 修改 | 同上 |
| **插件** | `plugins/wx_bank_monitor/plugin.py` | 修改 | 同上 |
| **插件** | `plugins/futu_monitor/plugin.py` | 修改 | 同上 |

---

## 2. 数据模型变更

### 2.1 `JournalEntry` — 移除 `reconciliation_status`

**文件：`server/app/models/journal.py`**

当前代码（L13-18, L43-46）：

```python
class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        Index("ix_journal_entries_book_date", "book_id", "entry_date"),
        Index("ix_journal_entries_book_type", "book_id", "entry_type"),
        Index("ix_journal_entries_book_reconciliation", "book_id", "reconciliation_status"),
    )
    # ...
    reconciliation_status: Mapped[str] = mapped_column(
        SAEnum("none", "pending", "confirmed", name="reconciliation_status"),
        default="none",
    )
```

变更后：

```python
class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        Index("ix_journal_entries_book_date", "book_id", "entry_date"),
        Index("ix_journal_entries_book_type", "book_id", "entry_type"),
        # ix_journal_entries_book_reconciliation 已删除
    )
    # ...
    # reconciliation_status 已删除
```

> 删除 `reconciliation_status` 字段和 `ix_journal_entries_book_reconciliation` 索引。`entry_type = "reconciliation"` 和 `source = "reconciliation"` 保留。

### 2.2 `BalanceSnapshot` — 枚举简化

**文件：`server/app/models/sync.py`**

当前代码（L67-70）：

```python
status: Mapped[str] = mapped_column(
    SAEnum("balanced", "pending", "reconciled", name="snapshot_status"),
    default="pending",
)
```

变更后：

```python
status: Mapped[str] = mapped_column(
    SAEnum("balanced", "reconciled", name="snapshot_status"),
    default="balanced",
)
```

> 移除 `pending` 枚举值，默认改为 `balanced`。余额快照有差异时一定会生成调账分录，所以只有 `balanced`（无差异）和 `reconciled`（已调账）两种状态。

---

## 3. 数据迁移

**文件：`server/scripts/migrate_v047_reconciliation.py`**

采用独立一次性迁移脚本（与 `migrate_account_codes.py` 风格一致），**不在 `database.py` 的 `init_db()` 中新增迁移函数**。脚本具备完整的备份和回滚功能。

### 3.1 使用方式

```bash
cd server

# 预览模式（仅显示受影响数据，不做任何修改）
python scripts/migrate_v047_reconciliation.py --dry-run

# 执行迁移（自动备份）
python scripts/migrate_v047_reconciliation.py

# 指定数据库路径
python scripts/migrate_v047_reconciliation.py /path/to/db.sqlite

# 回滚到迁移前状态（使用自动创建的备份文件）
python scripts/migrate_v047_reconciliation.py --rollback
```

### 3.2 脚本实现

```python
#!/usr/bin/env python3
"""v0.4.7 一次性数据迁移脚本：简化对账机制，移除 reconciliation_status 字段。

迁移步骤:
  1. 将 pending 分录 → confirmed（直接生效）
  2. 将 pending 快照 → reconciled
  3. 重建 journal_entries 表，移除 reconciliation_status 列
  4. 删除 ix_journal_entries_book_reconciliation 索引
  5. 重建必要索引

用法:
  python scripts/migrate_v047_reconciliation.py                    # 默认 data/home_accountant.db
  python scripts/migrate_v047_reconciliation.py /path/to/db.sqlite # 指定数据库路径
  python scripts/migrate_v047_reconciliation.py --dry-run          # 仅预览，不实际修改
  python scripts/migrate_v047_reconciliation.py --rollback         # 回滚到迁移前状态
"""

import sqlite3
import sys
import shutil
from pathlib import Path
from datetime import datetime

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "home_accountant.db"
BACKUP_SUFFIX = ".bak_v047"


def find_backup(db_path: Path) -> Path | None:
    """查找最新的 v0.4.7 备份文件"""
    backups = sorted(db_path.parent.glob(f"{db_path.stem}{BACKUP_SUFFIX}*"), reverse=True)
    return backups[0] if backups else None


def rollback(db_path: Path):
    """从备份恢复数据库"""
    backup = find_backup(db_path)
    if not backup:
        print(f"错误: 未找到 v0.4.7 备份文件（{db_path.parent}/{db_path.stem}{BACKUP_SUFFIX}*）")
        sys.exit(1)

    print(f"备份文件: {backup}")
    print(f"目标数据库: {db_path}")
    confirm = input("确认回滚？这将覆盖当前数据库 [y/N]: ").strip().lower()
    if confirm != "y":
        print("已取消。")
        return

    shutil.copy2(backup, db_path)
    print(f"已从 {backup.name} 恢复数据库。")


def migrate(db_path: Path, dry_run: bool = False):
    if not db_path.exists():
        print(f"错误: 数据库文件不存在 {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # 幂等检查：reconciliation_status 列是否还存在
    cursor.execute("PRAGMA table_info(journal_entries)")
    columns = {row[1] for row in cursor.fetchall()}
    if "reconciliation_status" not in columns:
        print("reconciliation_status 列不存在，已是最新状态，无需迁移。")
        conn.close()
        return

    # 统计受影响数据
    cursor.execute(
        "SELECT COUNT(*) FROM journal_entries WHERE reconciliation_status = 'pending'"
    )
    pending_entries = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COUNT(*) FROM balance_snapshots WHERE status = 'pending'"
    )
    pending_snapshots = cursor.fetchone()[0]

    print(f"受影响数据:")
    print(f"  pending 分录: {pending_entries} 条 → confirmed")
    print(f"  pending 快照: {pending_snapshots} 条 → reconciled")
    print(f"  journal_entries.reconciliation_status 列 → 移除")
    print(f"  ix_journal_entries_book_reconciliation 索引 → 删除")

    if dry_run:
        print("\n[dry-run] 预览完成，未做任何修改。")
        conn.close()
        return

    # 备份数据库
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_path = db_path.parent / f"{db_path.stem}{BACKUP_SUFFIX}.{timestamp}{db_path.suffix}"
    shutil.copy2(db_path, backup_path)
    print(f"\n已备份数据库到 {backup_path}")

    # Step 1: pending 分录 → confirmed
    cursor.execute(
        "UPDATE journal_entries SET reconciliation_status = 'confirmed' "
        "WHERE reconciliation_status = 'pending'"
    )
    print(f"\nStep 1: pending 分录 → confirmed ({cursor.rowcount} 行)")

    # Step 2: pending 快照 → reconciled
    cursor.execute(
        "UPDATE balance_snapshots SET status = 'reconciled' "
        "WHERE status = 'pending'"
    )
    print(f"Step 2: pending 快照 → reconciled ({cursor.rowcount} 行)")

    # Step 3: 重建 journal_entries 表，移除 reconciliation_status 列
    # SQLite 不支持 ALTER TABLE DROP COLUMN（3.35.0+ 支持但不保证），
    # 使用 CREATE TABLE AS SELECT → DROP → RENAME 模式，与 v0.4.2 一致。
    cursor.execute("PRAGMA table_info(journal_entries)")
    all_cols = [r[1] for r in cursor.fetchall()]
    cols_to_keep = [c for c in all_cols if c != "reconciliation_status"]
    cols_str = ", ".join(cols_to_keep)

    cursor.execute(
        f"CREATE TABLE journal_entries_v047 AS "
        f"SELECT {cols_str} FROM journal_entries"
    )
    cursor.execute("DROP TABLE journal_entries")
    cursor.execute("ALTER TABLE journal_entries_v047 RENAME TO journal_entries")
    print("Step 3: 重建 journal_entries 表，已移除 reconciliation_status 列")

    # Step 4: 重建索引（不再包含 reconciliation 索引）
    indexes = [
        ("ix_journal_entries_book_id", "journal_entries(book_id)"),
        ("ix_journal_entries_book_date", "journal_entries(book_id, entry_date)"),
        ("ix_journal_entries_book_type", "journal_entries(book_id, entry_type)"),
        ("ix_journal_entries_entry_date", "journal_entries(entry_date)"),
    ]
    for idx_name, idx_def in indexes:
        cursor.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {idx_def}")

    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_journal_entries_book_external "
        "ON journal_entries(book_id, external_id) "
        "WHERE external_id IS NOT NULL"
    )
    print("Step 4: 索引重建完成")

    conn.commit()

    # 验证
    cursor.execute("PRAGMA table_info(journal_entries)")
    final_cols = {r[1] for r in cursor.fetchall()}
    assert "reconciliation_status" not in final_cols, "迁移失败：列未被移除"
    print("\n验证通过：reconciliation_status 列已移除。")

    conn.close()
    print("迁移完成。")


if __name__ == "__main__":
    is_dry_run = "--dry-run" in sys.argv
    is_rollback = "--rollback" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    db_path = Path(args[0]) if args else DEFAULT_DB

    print(f"数据库: {db_path}")

    if is_rollback:
        print("模式: 回滚\n")
        rollback(db_path)
    else:
        print(f"模式: {'dry-run (仅预览)' if is_dry_run else '实际执行'}\n")
        migrate(db_path, is_dry_run)
```

> **设计要点**：
> - **独立脚本**：不在 `database.py` 的 `init_db()` 中追加迁移函数，避免每次启动都执行迁移逻辑
> - **备份**：迁移前自动备份为 `*.bak_v047.{timestamp}.db`
> - **回滚**：`--rollback` 参数可从备份文件恢复数据库
> - **幂等**：通过检查 `reconciliation_status` 列是否存在判断是否已迁移
> - **预览**：`--dry-run` 仅统计受影响数据，不做任何修改
> - **风格一致**：与 `scripts/migrate_account_codes.py` 保持一致的命令行用法和输出风格

---

## 4. Schema 层变更

### 4.1 `SnapshotCreateRequest` — 新增 `adjust_account_id`

**文件：`server/app/schemas/sync.py`**

当前代码（L5-7）：

```python
class SnapshotCreateRequest(BaseModel):
    external_balance: float
    snapshot_date: date | None = None
```

变更后：

```python
class SnapshotCreateRequest(BaseModel):
    external_balance: float
    snapshot_date: date | None = None
    adjust_account_id: str | None = None  # 调账科目 ID，不传则使用系统默认
```

### 4.2 删除 Pending 相关 Schema

删除以下类（整块删除）：

| 类名 | 行号 | 说明 |
|------|------|------|
| `ReconcileLineItem` | L23-30 | 待处理行项 |
| `ReconcileSnapshotInfo` | L33-39 | 快照摘要 |
| `PendingReconcileItem` | L42-48 | 待处理条目 |
| `ConfirmRequest` | L51-52 | 确认请求 |
| `ConfirmResponse` | L55-59 | 确认响应 |
| `SplitItem` | L62-65 | 拆分项 |
| `SplitRequest` | L68-69 | 拆分请求 |
| `SplitResponse` | L72-75 | 拆分响应 |
| `PendingCountResponse` | L78-79 | 待处理数量 |

### 4.3 `SnapshotResponse` — 移除 `reconciliation_entry_id`

当前代码（L10-20）：

```python
class SnapshotResponse(BaseModel):
    snapshot_id: str
    account_id: str
    account_name: str
    account_type: str
    snapshot_date: str
    external_balance: float
    book_balance: float
    difference: float
    status: str
    reconciliation_entry_id: str | None
```

变更后：

```python
class SnapshotResponse(BaseModel):
    snapshot_id: str
    account_id: str
    account_name: str
    account_type: str
    snapshot_date: str
    external_balance: float
    book_balance: float
    difference: float
    status: str  # "balanced" | "reconciled"
```

> `reconciliation_entry_id` 不再对外暴露——调节分录直接生效，用户无需关心其 ID。

### 4.4 变更后完整文件

```python
from datetime import date
from pydantic import BaseModel


class SnapshotCreateRequest(BaseModel):
    external_balance: float
    snapshot_date: date | None = None
    adjust_account_id: str | None = None


class SnapshotResponse(BaseModel):
    snapshot_id: str
    account_id: str
    account_name: str
    account_type: str
    snapshot_date: str
    external_balance: float
    book_balance: float
    difference: float
    status: str
```

---

## 5. Service 层变更

### 5.1 `reconciliation_service.py` — 删除函数

**文件：`server/app/services/reconciliation_service.py`**

删除以下 4 个函数（整块删除）：

| 函数 | 行号 | 说明 |
|------|------|------|
| `get_pending_reconciliations()` | L204-260 | 获取待处理队列 |
| `get_pending_count()` | L263-275 | 待处理数量 |
| `confirm_reconciliation()` | L278-336 | 确认分类 |
| `split_reconciliation()` | L339-433 | 拆分 |

### 5.2 `create_snapshot()` — 逻辑重写

当前签名（L55-62）：

```python
async def create_snapshot(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    account_id: str,
    external_balance: Decimal,
    snapshot_date: date | None = None,
) -> dict:
```

变更后签名：

```python
async def create_snapshot(
    db: AsyncSession,
    book_id: str,
    user_id: str,
    account_id: str,
    external_balance: Decimal,
    snapshot_date: date | None = None,
    adjust_account_id: str | None = None,  # ← 新增
) -> dict:
```

**核心逻辑变更**（L107-201 替换）：

当前逻辑：
1. 差异 != 0 → 查找/创建暂挂科目（"待分类收入"/"待分类费用"）
2. 生成 `reconciliation_status = "pending"` 的调节分录
3. 快照 `status = "pending"`

变更后逻辑：

```python
    # 创建快照（先设 balanced，后续根据差异可能更新为 reconciled）
    snapshot = BalanceSnapshot(
        data_source_id=data_source.id,
        account_id=account_id,
        snapshot_date=target_date,
        external_balance=float(external_balance),
        book_balance=float(book_balance),
        difference=float(difference),
        status="balanced",
    )

    # 差异 >= 0.01 → 生成调节分录
    if abs(difference) >= Decimal("0.01"):
        # 确定调账科目
        if adjust_account_id:
            # 使用指定的调账科目
            adj_result = await db.execute(
                select(Account).where(
                    Account.id == adjust_account_id,
                    Account.book_id == book_id,
                    Account.is_active == True,
                )
            )
            adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                raise ReconciliationError("调账科目不存在或已停用", 404)
        else:
            # 回退到系统默认科目
            if difference > 0:
                default_code, default_name, default_type = "4009", "其他收入", "income"
            else:
                default_code, default_name, default_type = "5099", "其他费用", "expense"

            adj_result = await db.execute(
                select(Account).where(
                    Account.book_id == book_id,
                    Account.code == default_code,
                    Account.is_active == True,
                )
            )
            adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                # 查找同名科目
                adj_result = await db.execute(
                    select(Account).where(
                        Account.book_id == book_id,
                        Account.name == default_name,
                        Account.type == default_type,
                        Account.is_active == True,
                    )
                )
                adjust_account = adj_result.scalar_one_or_none()
            if not adjust_account:
                # 自动创建默认科目
                adjust_account = Account(
                    book_id=book_id,
                    code=default_code,
                    name=default_name,
                    type=default_type,
                    balance_direction="credit" if default_type == "income" else "debit",
                    is_system=True,
                    sort_order=999,
                )
                db.add(adjust_account)
                await db.flush()

        abs_diff = abs(difference)

        entry = JournalEntry(
            book_id=book_id,
            user_id=user_id,
            entry_date=entry_datetime,
            entry_type="reconciliation",
            description=f"余额调节：{account.name}",
            source="reconciliation",
            # 不再设置 reconciliation_status — 字段已移除
        )

        if difference > 0:
            # 实际 > 账面：借 资产科目，贷 调账科目
            lines = [
                JournalLine(account_id=account_id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=adjust_account.id, debit_amount=0, credit_amount=abs_diff),
            ]
        else:
            # 实际 < 账面：借 调账科目，贷 资产科目
            lines = [
                JournalLine(account_id=adjust_account.id, debit_amount=abs_diff, credit_amount=0),
                JournalLine(account_id=account_id, debit_amount=0, credit_amount=abs_diff),
            ]

        entry.lines = lines
        db.add(entry)
        await db.flush()
        snapshot.reconciliation_entry_id = entry.id
        snapshot.status = "reconciled"

    db.add(snapshot)
    await db.flush()
    await db.refresh(snapshot)

    return {
        "snapshot_id": snapshot.id,
        "account_id": account_id,
        "account_name": account.name,
        "account_type": account.type,
        "snapshot_date": target_date.isoformat(),
        "external_balance": float(external_balance),
        "book_balance": float(book_balance),
        "difference": float(difference),
        "status": snapshot.status,
    }
```

**与当前实现的关键区别：**

| 项目 | 变更前 | 变更后 |
|------|--------|--------|
| 调账科目 | 暂挂到"待分类收入/费用" | 使用 `adjust_account_id` 或系统默认科目（4009/5099） |
| 分录状态 | `reconciliation_status = "pending"` | 字段已移除，分录直接生效 |
| 快照状态 | `"pending"` | `"reconciled"` |
| 返回值 | 包含 `reconciliation_entry_id` | 不返回 entry ID |

### 5.3 变更后完整文件结构

```python
"""对账服务：余额快照、差异计算、调节分录生成"""

# imports ...

class ReconciliationError(Exception): ...

async def _get_book_balance(db, account_id, book_id, as_of_date) -> Decimal: ...  # 不变

async def create_snapshot(
    db, book_id, user_id, account_id, external_balance,
    snapshot_date=None, adjust_account_id=None,     # ← 新增参数
) -> dict: ...  # 重写

# get_pending_reconciliations — 已删除
# get_pending_count — 已删除
# confirm_reconciliation — 已删除
# split_reconciliation — 已删除
```

---

## 6. Router 层变更

### 6.1 `sync.py` — 删除 4 个端点

**文件：`server/app/routers/sync.py`**

删除以下端点（整块删除）：

| 方法 | 路径 | 行号 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/pending-reconciliations` | L86-99 | 待处理队列 |
| `GET` | `/books/{book_id}/pending-count` | L102-115 | 待处理数量 |
| `PUT` | `/entries/{entry_id}/confirm` | L118-137 | 确认分类 |
| `POST` | `/entries/{entry_id}/split` | L140-160 | 拆分 |

同步删除：
- `_check_entry_book` 辅助函数（L39-46）— 仅被 confirm/split 使用
- imports 中的 `PendingReconcileItem`、`ConfirmRequest`、`ConfirmResponse`、`SplitRequest`、`SplitResponse`、`PendingCountResponse`
- imports 中的 `get_pending_reconciliations`、`get_pending_count`、`confirm_reconciliation`、`split_reconciliation`
- imports 中的 `get_entry_detail`（仅被 `_check_entry_book` 使用）

### 6.2 `submit_snapshot` 端点 — 适配新参数

当前代码（L49-83）：

```python
@router.post(
    "/accounts/{account_id}/snapshot",
    response_model=SnapshotResponse,
    status_code=201,
    summary="提交余额快照",
)
async def submit_snapshot(
    account_id: str,
    body: SnapshotCreateRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    # ...
    try:
        data = await create_snapshot(
            db,
            book_id=account.book_id,
            user_id=current_user.id,
            account_id=account_id,
            external_balance=Decimal(str(body.external_balance)),
            snapshot_date=body.snapshot_date,
        )
        return SnapshotResponse(**data)
```

变更后：

```python
    try:
        data = await create_snapshot(
            db,
            book_id=account.book_id,
            user_id=current_user.id,
            account_id=account_id,
            external_balance=Decimal(str(body.external_balance)),
            snapshot_date=body.snapshot_date,
            adjust_account_id=body.adjust_account_id,  # ← 新增
        )
        return SnapshotResponse(**data)
```

### 6.3 变更后完整路由文件

```python
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.sync import SnapshotCreateRequest, SnapshotResponse
from app.services.reconciliation_service import create_snapshot, ReconciliationError
from app.services.book_service import user_has_book_access
from app.utils.api_key_auth import get_current_user_flexible

router = APIRouter(tags=["对账同步"])


async def _check_book(user_id: str, book_id: str, db: AsyncSession):
    if not await user_has_book_access(db, user_id, book_id):
        raise HTTPException(status_code=403, detail="无权访问该账本")


@router.post(
    "/accounts/{account_id}/snapshot",
    response_model=SnapshotResponse,
    status_code=201,
    summary="提交余额快照",
)
async def submit_snapshot(
    account_id: str,
    body: SnapshotCreateRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """提交外部余额，系统计算差异并自动生成调节分录"""
    from app.models.account import Account
    from sqlalchemy import select
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="科目不存在")

    await _check_book(current_user.id, account.book_id, db)

    try:
        data = await create_snapshot(
            db,
            book_id=account.book_id,
            user_id=current_user.id,
            account_id=account_id,
            external_balance=Decimal(str(body.external_balance)),
            snapshot_date=body.snapshot_date,
            adjust_account_id=body.adjust_account_id,
        )
        return SnapshotResponse(**data)
    except ReconciliationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
```

---

## 7. MCP 工具变更

### 7.1 `sync.py` — `sync_balance` 新增参数

**文件：`server/mcp_server/tools/sync.py`**

当前代码（L10-28）：

```python
@mcp.tool()
async def sync_balance(
    account_id: str,
    external_balance: float,
    snapshot_date: str = "",
) -> str:
    """提交科目余额快照，系统自动计算差额并生成调节分录。"""
    if not snapshot_date:
        from datetime import date
        snapshot_date = date.today().isoformat()
    result = await ha_client.submit_snapshot(account_id, external_balance, snapshot_date)
    return json.dumps(result, ensure_ascii=False, indent=2)
```

变更后：

```python
@mcp.tool()
async def sync_balance(
    account_id: str,
    external_balance: float,
    snapshot_date: str = "",
    adjust_account_id: str = "",
) -> str:
    """提交科目余额快照，系统自动计算差额并生成调节分录。

    - account_id: 科目 ID（使用 list_accounts 获取）
    - external_balance: 外部真实余额（数字）
    - snapshot_date: 快照日期 (YYYY-MM-DD)，默认今天
    - adjust_account_id: 调账科目 ID，不传则使用系统默认科目（其他收入/其他费用）

    使用前请先调用 list_accounts 获取科目 ID。
    """
    if not snapshot_date:
        from datetime import date
        snapshot_date = date.today().isoformat()
    result = await ha_client.submit_snapshot(
        account_id, external_balance, snapshot_date,
        adjust_account_id=adjust_account_id or None,
    )
    return json.dumps(result, ensure_ascii=False, indent=2)
```

### 7.2 `client.py` — `submit_snapshot` 新增参数

**文件：`server/mcp_server/client.py`**

当前代码（L72-76）：

```python
async def submit_snapshot(self, account_id: str, external_balance: float, snapshot_date: str) -> dict:
    return await self._request("POST", f"/accounts/{account_id}/snapshot", json={
        "external_balance": external_balance,
        "snapshot_date": snapshot_date,
    })
```

变更后：

```python
async def submit_snapshot(
    self, account_id: str, external_balance: float, snapshot_date: str,
    adjust_account_id: str | None = None,
) -> dict:
    body: dict = {
        "external_balance": external_balance,
        "snapshot_date": snapshot_date,
    }
    if adjust_account_id:
        body["adjust_account_id"] = adjust_account_id
    return await self._request("POST", f"/accounts/{account_id}/snapshot", json=body)
```

---

## 8. 前端变更

### 8.1 删除文件

| 文件 | 说明 |
|------|------|
| `client/app/sync/reconcile.tsx` | 待处理对账页面（372 行） |
| `client/features/sync/ReconcileCard.tsx` | 对账卡片组件（168 行） |
| `client/features/sync/BalanceCompare.tsx` | 余额对比组件（103 行） |
| `client/features/sync/index.ts` | sync 模块导出（3 行） |

### 8.2 `syncService.ts` — 删除方法 + 类型精简

**文件：`client/services/syncService.ts`**

变更后完整文件：

```typescript
import api from './api';

export type SnapshotResponse = {
  snapshot_id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  snapshot_date: string;
  external_balance: number;
  book_balance: number;
  difference: number;
  status: string;  // "balanced" | "reconciled"
};

export const syncService = {
  submitSnapshot: (
    accountId: string,
    externalBalance: number,
    snapshotDate?: string,
    adjustAccountId?: string,
  ) =>
    api.post<SnapshotResponse>(`/accounts/${accountId}/snapshot`, {
      external_balance: externalBalance,
      snapshot_date: snapshotDate || undefined,
      adjust_account_id: adjustAccountId || undefined,
    }),
};
```

删除的类型：`ReconcileLineItem`、`ReconcileSnapshotInfo`、`PendingReconcileItem`、`ConfirmResponse`、`SplitResponse`、`PendingCountResponse`

删除的方法：`getPendingReconciliations`、`getPendingCount`、`confirmReconciliation`、`splitReconciliation`

### 8.3 `_layout.tsx` — 移除路由

**文件：`client/app/_layout.tsx`**

删除第 138 行：

```tsx
// 删除
<Stack.Screen name="sync/reconcile" options={{ headerShown: false, title: '待处理对账' }} />
```

### 8.4 `index.tsx` (Dashboard) — 移除 pending 逻辑

**文件：`client/app/(tabs)/index.tsx`**

**1. 删除 import**（L22）：

```typescript
// 删除
import { syncService } from '@/services/syncService';
```

**2. 删除 state**（L65）：

```typescript
// 删除
const [pendingCount, setPendingCount] = useState(0);
```

**3. 简化 fetchData**（L78-87）：

当前：

```typescript
const [dashRes, trendRes, expRes, pendingRes] = await Promise.all([
  reportService.getDashboard(currentBook.id),
  reportService.getNetWorthTrend(currentBook.id, 6),
  reportService.getExpenseBreakdown(currentBook.id, monthStart, monthEnd),
  syncService.getPendingCount(currentBook.id),
]);
setDashboard(dashRes.data);
setTrend(trendRes.data);
setExpenseBreakdown(expRes.data);
setPendingCount(pendingRes.data.count);
```

变更后：

```typescript
const [dashRes, trendRes, expRes] = await Promise.all([
  reportService.getDashboard(currentBook.id),
  reportService.getNetWorthTrend(currentBook.id, 6),
  reportService.getExpenseBreakdown(currentBook.id, monthStart, monthEnd),
]);
setDashboard(dashRes.data);
setTrend(trendRes.data);
setExpenseBreakdown(expRes.data);
```

**4. 删除 pendingSection**（L197-213，整块删除）：

```tsx
// 删除整个 pendingSection 定义
const pendingSection = pendingCount > 0 ? ( ... ) : null;
```

**5. 移除渲染引用**：

桌面端 `<ScrollView>` 内（L267）和移动端布局（L306）中删除 `{pendingSection}`。

**6. 删除 pending 相关样式**（L397-434）：

删除 `pendingCard`、`pendingLeft`、`pendingText`、`pendingRight`、`pendingBadge`、`pendingBadgeText` 样式。

### 8.5 `accounts/[id].tsx` — 对账 toast 简化

**文件：`client/app/accounts/[id].tsx`**

当前 `handleSnapshot`（L113-135）中的 toast：

```typescript
if (data.status === 'balanced') {
    showToast('成功', '余额一致，无需调节');
} else {
    const diffStr = Math.abs(data.difference).toFixed(2);
    showToast('已生成调节分录', `差异 ¥${diffStr}，已生成待分类调节分录`);
}
```

变更后：

```typescript
if (data.status === 'balanced') {
    showToast('成功', '余额一致，无需调节');
} else {
    const diffStr = Math.abs(data.difference).toFixed(2);
    showToast('成功', `已生成调节分录：¥${diffStr}`);
}
```

> 移除"待分类"措辞——分录已直接使用正确科目生成。

### 8.6 `AccountsPane.tsx` — 对账 toast 简化

**文件：`client/features/account/AccountsPane.tsx`**

当前 `handleSnapshot`（L224-242）中的 toast：

```typescript
if (data.status === 'balanced') {
    showToast('余额一致，无需调节');
} else {
    showToast(`差异 ¥${Math.abs(data.difference).toFixed(2)}，已生成待分类调节分录`);
}
```

变更后：

```typescript
if (data.status === 'balanced') {
    showToast('余额一致，无需调节');
} else {
    showToast(`已生成调节分录：¥${Math.abs(data.difference).toFixed(2)}`);
}
```

### 8.7 `BalanceSheetTable.tsx` — 移除跳转链接

**文件：`client/features/report/BalanceSheetTable.tsx`**

当前 `handleSubmitSnapshot`（L365-377）中：

```typescript
if (res.status === 'balanced') {
    showToast('余额一致，无需调节', 'success');
} else {
    const diffStr = Math.abs(res.difference).toFixed(2);
    showToast(`差异 ¥${diffStr}，已生成调节分录`, 'warning', true);
}
```

变更后：

```typescript
if (res.status === 'balanced') {
    showToast('余额一致，无需调节', 'success');
} else {
    const diffStr = Math.abs(res.difference).toFixed(2);
    showToast(`已生成调节分录：¥${diffStr}`, 'success');
}
```

同时删除 toast 中的"前往确认分类 →"跳转链接（L437-439）：

```tsx
// 删除
{toastLink && (
    <Pressable onPress={() => { setToastMsg(''); router.push('/sync/reconcile' as any); }}>
        <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>前往确认分类 →</Text>
    </Pressable>
)}
```

以及 `showToast` 函数中的 `toastLink` 参数和相关 state，如果存在的话。

---

## 9. 插件端变更

### 9.1 CONFIG_SCHEMA 新增 `adjust_account_id`

所有 4 个插件均新增字段。以东方财富为例：

**文件：`plugins/eastmoney_monitor/plugin.py`**

在 `CONFIG_SCHEMA["fields"]` 数组中，`securities_account_id` 字段之后新增：

```python
{
    "key": "adjust_account_id",
    "label": "调账科目",
    "type": "account_select",
    "required": False,
    "depends_on": "target_book",
    "description": "余额差异自动调账的目标科目（如投资收益），不设则使用系统默认科目（其他收入/其他费用）",
},
```

其余三个插件同理（`longport_monitor`、`futu_monitor`、`wx_bank_monitor`）。

### 9.2 `HAClient.submit_balance_snapshot` — 新增参数

所有 4 个插件的 `HAClient` 类中，`submit_balance_snapshot` 方法新增 `adjust_account_id` 参数：

当前代码（以东财为例，L225-237）：

```python
def submit_balance_snapshot(
    self, account_id: str, external_balance: float, snapshot_date: str
) -> dict:
    resp = self.session.post(
        f"{self.base_url}/accounts/{account_id}/snapshot",
        json={
            "external_balance": external_balance,
            "snapshot_date": snapshot_date,
        },
    )
    resp.raise_for_status()
    return resp.json()
```

变更后：

```python
def submit_balance_snapshot(
    self, account_id: str, external_balance: float, snapshot_date: str,
    adjust_account_id: str | None = None,
) -> dict:
    body: dict = {
        "external_balance": external_balance,
        "snapshot_date": snapshot_date,
    }
    if adjust_account_id:
        body["adjust_account_id"] = adjust_account_id
    resp = self.session.post(
        f"{self.base_url}/accounts/{account_id}/snapshot",
        json=body,
    )
    resp.raise_for_status()
    return resp.json()
```

### 9.3 同步逻辑 — 传入调账科目

以东方财富的 `do_sync`（balance 提交部分）为例：

当前代码（L350-371）：

```python
for book_id in book_ids:
    securities_account_id = account_mapping.get(book_id) if isinstance(account_mapping, dict) else account_mapping
    if not securities_account_id:
        logger.warning("账本 %s 缺少科目映射，跳过", book_id)
        continue
    try:
        snap_result = client.submit_balance_snapshot(
            securities_account_id, total_asset, snapshot_date
        )
```

变更后：

```python
# 获取调账科目映射
adjust_mapping = plugin_config.get("adjust_account_id", {})
if isinstance(adjust_mapping, str):
    adjust_mapping = {book_ids[0]: adjust_mapping} if book_ids else {}

for book_id in book_ids:
    securities_account_id = account_mapping.get(book_id) if isinstance(account_mapping, dict) else account_mapping
    if not securities_account_id:
        logger.warning("账本 %s 缺少科目映射，跳过", book_id)
        continue
    adjust_account_id = adjust_mapping.get(book_id) if isinstance(adjust_mapping, dict) else adjust_mapping
    try:
        snap_result = client.submit_balance_snapshot(
            securities_account_id, total_asset, snapshot_date,
            adjust_account_id=adjust_account_id or None,
        )
```

其余三个插件同理（`longport_monitor`、`futu_monitor`、`wx_bank_monitor`）。`wx_bank_monitor` 中 `submit_balance_snapshot` 的调用也需同步适配。

---

## 10. 测试变更

### 10.1 `test_sync.py` — 重写

**文件：`server/tests/test_sync.py`**

删除整个 `TestPendingReconciliations`、`TestConfirmReconciliation`、`TestSplitReconciliation` 类。

修改 `TestSnapshot`：

```python
class TestSnapshot:

    @pytest.mark.asyncio
    async def test_snapshot_no_difference(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额一致 → difference=0, status=balanced"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["difference"] == pytest.approx(0, abs=0.01)
        assert data["status"] == "balanced"

    @pytest.mark.asyncio
    async def test_snapshot_with_difference_default_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """余额有差异，无调账科目 → 使用系统默认科目生成调节分录，status=reconciled"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["difference"] != 0
        assert data["status"] == "reconciled"

    @pytest.mark.asyncio
    async def test_snapshot_with_adjust_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定调账科目 → 使用该科目生成调节分录"""
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

    @pytest.mark.asyncio
    async def test_snapshot_invalid_adjust_account(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """无效的调账科目 → 报错"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 500, "adjust_account_id": "nonexistent"},
            headers=auth_headers,
        )
        # 差异 != 0 时尝试使用无效科目 → 应返回错误
        assert resp.status_code in (400, 404)

    @pytest.mark.asyncio
    async def test_deleted_endpoints_return_404(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """已删除的端点返回 404/405"""
        resp1 = await client.get(
            f"/books/{test_book.id}/pending-reconciliations",
            headers=auth_headers,
        )
        assert resp1.status_code in (404, 405)

        resp2 = await client.get(
            f"/books/{test_book.id}/pending-count",
            headers=auth_headers,
        )
        assert resp2.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_snapshot_with_date(
        self, client: AsyncClient, auth_headers, test_book: Book
    ):
        """指定快照日期"""
        cash_id = await _get_account_id(client, test_book.id, "1001-01", auth_headers)

        resp = await client.post(
            f"/accounts/{cash_id}/snapshot",
            json={"external_balance": 0, "snapshot_date": "2025-06-01"},
            headers=auth_headers,
        )
        assert resp.status_code == 201

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
```

---

## 11. 开发实施计划

### 阶段 1：数据迁移 + Model 变更（预计 0.5 天）

1. 新增 `scripts/migrate_v047_reconciliation.py` 一次性迁移脚本（含备份、回滚、dry-run）
2. `models/journal.py` 移除 `reconciliation_status` 字段和索引
3. `models/sync.py` `BalanceSnapshot.status` 枚举简化
4. 本地测试迁移脚本（`--dry-run` 预览 → 执行迁移 → 验证 → `--rollback` 回滚验证）

### 阶段 2：后端 Schema + Service + Router（预计 0.5 天）

1. `schemas/sync.py` 精简（删除 pending 类型，新增 `adjust_account_id`）
2. `reconciliation_service.py` 删除 4 个函数，重写 `create_snapshot`
3. `routers/sync.py` 删除 4 个端点，适配新参数
4. `mcp_server/tools/sync.py` + `mcp_server/client.py` 新增 `adjust_account_id`

### 阶段 3：后端测试（预计 0.5h）

1. `test_sync.py` 重写，覆盖新逻辑

### 阶段 4：前端删除 + 清理（预计 0.5h）

1. 删除 4 个文件（`reconcile.tsx`、`ReconcileCard.tsx`、`BalanceCompare.tsx`、`index.ts`）
2. `_layout.tsx` 移除路由
3. `syncService.ts` 精简

### 阶段 5：前端修改（预计 0.5h）

1. `index.tsx` (Dashboard) 移除 pending 逻辑和样式
2. `accounts/[id].tsx` 对账 toast 简化
3. `AccountsPane.tsx` 同上
4. `BalanceSheetTable.tsx` 移除跳转链接

### 阶段 6：插件端适配（预计 0.5 天）

1. 4 个插件 CONFIG_SCHEMA 新增 `adjust_account_id` 字段
2. 4 个插件 `HAClient.submit_balance_snapshot` 新增参数
3. 4 个插件同步逻辑传入调账科目

### 阶段 7：联调 & 测试（预计 0.5 天）

1. 数据迁移验证（现有数据 pending → confirmed/reconciled）
2. 端到端：插件同步 → 余额快照 → 自动调节分录生成（指定科目 / 默认科目）
3. 用户手动对账（科目详情页 / 资产负债表）→ Toast 正确
4. Dashboard 无 pending 入口
5. 已删除 API 返回 404
6. 台账页对账调节分录正常显示

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 数据迁移 + Model | 0.5 天 | 0.5 天 |
| 2 | Schema + Service + Router | 0.5 天 | 1 天 |
| 3 | 后端测试 | 0.5h | ~1 天 |
| 4 | 前端删除 | 0.5h | ~1 天 |
| 5 | 前端修改 | 0.5h | ~1.5 天 |
| 6 | 插件端适配 | 0.5 天 | 2 天 |
| 7 | 联调 & 测试 | 0.5 天 | 2.5 天 |

> v0.4.7 总计约 **2.5 个工作日**。

### 实施顺序 & 依赖

```
阶段 1 (迁移 + Model) → 阶段 2 (Service + Router) → 阶段 3 (测试)
                              ↓
                        阶段 4 (前端删除) → 阶段 5 (前端修改)
                              ↓
                        阶段 6 (插件端)
                              ↓
                        阶段 7 (联调)
```

- 阶段 1、2 必须顺序执行（Model 变更先行）
- 阶段 4、5 可在阶段 2 完成后并行
- 阶段 6 依赖阶段 2（API 接口变更）
- 阶段 7 依赖所有阶段完成

---

## 12. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| `adjust_account_id` 越权 | `create_snapshot` 中校验科目属于同一 `book_id` 且 `is_active` |
| 迁移数据丢失 | SQLite 表重建前检查列是否存在（幂等），生产环境建议先备份 |
| 删除 API 后插件兼容 | 插件不调用 pending 相关 API，无影响 |
| 默认科目不存在 | 三级回退：code 查找 → 名称查找 → 自动创建 |

---

## 13. 向后兼容

| 项目 | 兼容性 |
|------|--------|
| `POST /accounts/{id}/snapshot` | **兼容**。`adjust_account_id` 为可选参数，不传时回退默认科目 |
| 插件 `submit_balance_snapshot` | **兼容**。新参数为可选，旧版插件不传也能正常工作 |
| 已有 `entry_type = "reconciliation"` 分录 | **兼容**。台账页标签逻辑不变 |
| 已有 `source = "reconciliation"` 分录 | **兼容** |
| `SnapshotResponse` 移除 `reconciliation_entry_id` | **破坏性变更**。前端已同步删除该字段的使用；MCP 工具返回结果中不再包含 |
