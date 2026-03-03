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

    # 检查 journal_entries 表是否存在
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='journal_entries'")
    if not cursor.fetchone():
        print("journal_entries 表不存在，无需迁移。")
        conn.close()
        return

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
        "SELECT name FROM sqlite_master WHERE type='table' AND name='balance_snapshots'"
    )
    has_snapshots_table = cursor.fetchone() is not None

    pending_snapshots = 0
    if has_snapshots_table:
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
    if has_snapshots_table:
        cursor.execute(
            "UPDATE balance_snapshots SET status = 'reconciled' "
            "WHERE status = 'pending'"
        )
        print(f"Step 2: pending 快照 → reconciled ({cursor.rowcount} 行)")
    else:
        print("Step 2: balance_snapshots 表不存在，跳过")

    # Step 3: 重建 journal_entries 表，移除 reconciliation_status 列
    # SQLite 不支持 ALTER TABLE DROP COLUMN（3.35.0+ 支持但不保证）。
    # 注意：不能用 CREATE TABLE AS SELECT，因为会丢失主键、外键、NOT NULL 等约束。
    # 正确做法：从原 DDL 中去掉目标列，创建新表结构，再 INSERT 数据。

    # 获取原表 DDL
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='journal_entries'")
    original_ddl = cursor.fetchone()[0]

    # 从 DDL 中移除 reconciliation_status 相关行
    # DDL 格式: CREATE TABLE xxx (\n\tcol1 ..., \n\tcol2 ..., \n\t...\n)
    ddl_lines = original_ddl.split("\n")
    new_ddl_lines = []
    for line in ddl_lines:
        if "reconciliation_status" in line.lower():
            continue
        new_ddl_lines.append(line)

    # 重新拼接并修复逗号：找到 ")" 结尾行之前的最后一个定义行，去除尾部多余逗号
    # 策略：将中间定义行（第2行到倒数第2行）提取，去掉每行尾部逗号后重新用逗号连接
    header = new_ddl_lines[0]  # CREATE TABLE xxx (
    footer = new_ddl_lines[-1]  # )
    body_lines = new_ddl_lines[1:-1]

    # 去掉每行尾部的 ", " 或 ","，然后统一加回逗号（最后一行除外）
    cleaned_body = []
    for line in body_lines:
        cleaned_body.append(line.rstrip().rstrip(","))

    rejoined_body = []
    for i, line in enumerate(cleaned_body):
        if i < len(cleaned_body) - 1:
            rejoined_body.append(line + ",")
        else:
            rejoined_body.append(line)

    new_ddl = header + "\n" + "\n".join(rejoined_body) + "\n" + footer

    # 将表名改为临时名（只替换 CREATE TABLE 后的第一个出现）
    import re
    new_ddl = re.sub(
        r"(CREATE TABLE\s+)journal_entries(\s*\()",
        r"\1journal_entries_v047_new\2",
        new_ddl,
        count=1,
    )

    # 获取要保留的列
    cursor.execute("PRAGMA table_info(journal_entries)")
    all_cols = [r[1] for r in cursor.fetchall()]
    cols_to_keep = [c for c in all_cols if c != "reconciliation_status"]
    cols_str = ", ".join(cols_to_keep)

    # 创建新表（保留完整约束）
    cursor.execute(new_ddl)

    # 迁移数据
    cursor.execute(
        f"INSERT INTO journal_entries_v047_new ({cols_str}) "
        f"SELECT {cols_str} FROM journal_entries"
    )

    # 删除旧表，重命名新表
    cursor.execute("DROP TABLE journal_entries")
    cursor.execute("ALTER TABLE journal_entries_v047_new RENAME TO journal_entries")
    print("Step 3: 重建 journal_entries 表，已移除 reconciliation_status 列（保留主键/外键约束）")

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
