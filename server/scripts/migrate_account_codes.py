#!/usr/bin/env python3
"""独立数据迁移脚本：修正资产类系统科目编号，与 CHART_OF_ACCOUNTS.md 对齐。

旧编号(seed.py 错误)  →  新编号(文档正确)
  1101 应收款项       →  1301 应收款项
  1201 短期投资       →  1101 短期投资
  1301 预付款项       →  1401 预付款项
  1601 长期投资       →  1201 长期投资

用法:
  python scripts/migrate_account_codes.py                    # 默认 data/home_accountant.db
  python scripts/migrate_account_codes.py /path/to/db.sqlite # 指定数据库路径
  python scripts/migrate_account_codes.py --dry-run          # 仅预览，不实际修改
"""

import sqlite3
import sys
import shutil
from pathlib import Path
from datetime import datetime

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "home_accountant.db"

# 阶段 1: 旧编号 → 临时编号（避免 UNIQUE 冲突）
PHASE1 = [
    ("1101", "_TMP_1101"),
    ("1201", "_TMP_1201"),
    ("1301", "_TMP_1301"),
    ("1601", "_TMP_1601"),
]

# 阶段 2: 临时编号 → 正确编号 + 修正 name/icon/sort_order
PHASE2 = [
    # (临时编号, 新编号, 名称, icon, sort_order)
    ("_TMP_1201", "1101", "短期投资", "stock", 300),
    ("_TMP_1601", "1201", "长期投资", "investment", 400),
    ("_TMP_1101", "1301", "应收款项", "receivable", 500),
    ("_TMP_1301", "1401", "预付款项", "prepaid", 600),
]

# 未受影响的一级科目 sort_order 同步
SORT_FIXES = [
    ("1001", 100),
    ("1002", 200),
    ("1501", 700),
    ("1502", 710),
    ("1503", 720),
]


def migrate(db_path: Path, dry_run: bool = False):
    if not db_path.exists():
        print(f"错误: 数据库文件不存在 {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # 检查 accounts 表是否存在
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    if not cursor.fetchone():
        print("accounts 表不存在，无需迁移。")
        conn.close()
        return

    # 检查是否有旧编号（幂等判断）
    cursor.execute("SELECT COUNT(*) FROM accounts WHERE code = '1601' AND is_system = 1")
    count = cursor.fetchone()[0]
    if count == 0:
        print("未发现旧编号 1601 的系统科目，已是最新状态，无需迁移。")
        conn.close()
        return

    # 统计受影响的行数
    cursor.execute(
        "SELECT code, name, book_id FROM accounts "
        "WHERE code IN ('1101','1201','1301','1601') AND is_system = 1 "
        "ORDER BY book_id, code"
    )
    affected = cursor.fetchall()
    book_ids = set(row[2] for row in affected)
    print(f"发现 {len(affected)} 条需迁移的科目记录，涉及 {len(book_ids)} 个账本：")
    for code, name, book_id in affected:
        print(f"  [{book_id[:8]}...] {code} {name}")

    if dry_run:
        print("\n[dry-run] 预览完成，未做任何修改。")
        conn.close()
        return

    # 备份数据库
    backup_path = db_path.parent / f"{db_path.stem}.bak.{datetime.now().strftime('%Y%m%d%H%M%S')}{db_path.suffix}"
    shutil.copy2(db_path, backup_path)
    print(f"\n已备份数据库到 {backup_path}")

    # 阶段 1
    print("\n阶段 1: 旧编号 → 临时编号")
    for old_code, tmp_code in PHASE1:
        cursor.execute(
            "UPDATE accounts SET code = ? WHERE code = ? AND is_system = 1",
            (tmp_code, old_code),
        )
        print(f"  {old_code} → {tmp_code}  ({cursor.rowcount} 行)")

    # 阶段 2
    print("\n阶段 2: 临时编号 → 正确编号")
    for tmp_code, new_code, name, icon, sort in PHASE2:
        cursor.execute(
            "UPDATE accounts SET code = ?, name = ?, icon = ?, sort_order = ? "
            "WHERE code = ? AND is_system = 1",
            (new_code, name, icon, sort, tmp_code),
        )
        print(f"  {tmp_code} → {new_code} {name}  ({cursor.rowcount} 行)")

    # sort_order 同步
    print("\n同步其余科目 sort_order:")
    for code, sort in SORT_FIXES:
        cursor.execute(
            "UPDATE accounts SET sort_order = ? WHERE code = ? AND is_system = 1",
            (sort, code),
        )
        if cursor.rowcount:
            print(f"  {code} sort_order → {sort}  ({cursor.rowcount} 行)")

    conn.commit()
    conn.close()
    print("\n迁移完成。")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    db_path = Path(args[0]) if args else DEFAULT_DB
    print(f"数据库: {db_path}")
    print(f"模式: {'dry-run (仅预览)' if dry_run else '实际执行'}\n")
    migrate(db_path, dry_run)
