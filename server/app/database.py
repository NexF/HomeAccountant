"""数据库初始化 - SQLite + async SQLAlchemy"""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """创建所有表，并对已有表进行增量迁移"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # v0.0.2: budgets 表新增字段迁移
        await _migrate_budgets(conn)
        # v0.2.0: journal_entries 表新增 external_id 字段
        await _migrate_journal_external_id(conn)
        # v0.4.0: users 表新增 is_active / last_active_at 字段
        await _migrate_users_admin(conn)
        # v0.4.1: plugins 表新增 config_schema / config 字段
        await _migrate_plugin_config(conn)
        # v0.4.2: plugins 表新增 display_name 字段
        await _migrate_plugin_display_name(conn)
        # v0.4.2: journal_entries.entry_date 从 DATE 迁移为 TIMESTAMP
        await _migrate_entry_date_to_datetime(conn)


async def _migrate_budgets(conn):
    """为 budgets 表补充 v0.0.2 新增的列（如果尚未存在）"""
    from sqlalchemy import text

    # 检查列是否已存在
    result = await conn.execute(text("PRAGMA table_info(budgets)"))
    columns = {row[1] for row in result.fetchall()}

    migrations = [
        ("alert_threshold", "ALTER TABLE budgets ADD COLUMN alert_threshold DECIMAL(3,2) DEFAULT 0.80"),
        ("is_active", "ALTER TABLE budgets ADD COLUMN is_active BOOLEAN DEFAULT 1"),
        ("created_at", "ALTER TABLE budgets ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "ALTER TABLE budgets ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ]
    for col_name, sql in migrations:
        if col_name not in columns:
            await conn.execute(text(sql))


async def _migrate_journal_external_id(conn):
    """为 journal_entries 表补充 v0.2.0 新增的 external_id 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(journal_entries)"))
    columns = {row[1] for row in result.fetchall()}

    if "external_id" not in columns:
        await conn.execute(
            text("ALTER TABLE journal_entries ADD COLUMN external_id VARCHAR(128)")
        )
        # 为 book_id + external_id 创建唯一索引（仅对非 NULL 值）
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_journal_entries_book_external "
            "ON journal_entries(book_id, external_id) "
            "WHERE external_id IS NOT NULL"
        ))


async def _migrate_users_admin(conn):
    """为 users 表补充 v0.4.0 新增的 is_active 和 last_active_at 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}

    migrations = [
        ("is_active", "ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"),
        ("last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP"),
    ]
    for col_name, sql in migrations:
        if col_name not in columns:
            await conn.execute(text(sql))


async def _migrate_plugin_config(conn):
    """为 plugins 表补充 v0.4.1 新增的 config_schema 和 config 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(plugins)"))
    columns = {row[1] for row in result.fetchall()}

    migrations = [
        ("config_schema", "ALTER TABLE plugins ADD COLUMN config_schema TEXT"),
        ("config", "ALTER TABLE plugins ADD COLUMN config TEXT"),
    ]
    for col_name, sql in migrations:
        if col_name not in columns:
            await conn.execute(text(sql))


async def _migrate_plugin_display_name(conn):
    """为 plugins 表补充 v0.4.2 新增的 display_name 列"""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(plugins)"))
    columns = {row[1] for row in result.fetchall()}

    if "display_name" not in columns:
        await conn.execute(
            text("ALTER TABLE plugins ADD COLUMN display_name VARCHAR(100)")
        )


async def _migrate_entry_date_to_datetime(conn):
    """将 journal_entries.entry_date 从 DATE 迁移为 TIMESTAMP（幂等）。

    SQLite 不支持 ALTER COLUMN，需要重建表。
    迁移策略：
      1. 抽样检查当前列是否已包含时间信息
      2. 若为纯日期格式，通过 CREATE TABLE AS + 数据迁移 + DROP + RENAME 完成
      3. 重建索引
    """
    from sqlalchemy import text
    import shutil
    import os

    # 幂等检查：表是否存在
    check = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='journal_entries'")
    )
    if not check.fetchone():
        return  # 表不存在，无需迁移

    # 幂等检查：抽样查看是否已含时间
    sample = await conn.execute(
        text("SELECT entry_date FROM journal_entries LIMIT 1")
    )
    row = sample.fetchone()
    if row is None:
        return  # 空表，无需迁移
    val = str(row[0]) if row[0] else ""
    if "T" in val or (" " in val and ":" in val):
        return  # 已包含时间信息，无需迁移

    # 备份数据库文件
    db_path = str(conn.engine.url).replace("sqlite+aiosqlite:///", "")
    if os.path.exists(db_path):
        shutil.copy2(db_path, db_path + ".bak_v042")

    # SQLite 迁移：添加新列 → 数据迁移 → 重建表
    await conn.execute(text(
        "ALTER TABLE journal_entries ADD COLUMN entry_date_new TIMESTAMP"
    ))
    await conn.execute(text(
        "UPDATE journal_entries SET entry_date_new = entry_date || 'T00:00:00'"
    ))

    # 获取所有列名（排除 entry_date 和 entry_date_new，用 entry_date_new 替代 entry_date）
    result = await conn.execute(text("PRAGMA table_info(journal_entries)"))
    all_cols = [r[1] for r in result.fetchall()]

    cols_without_old = [c for c in all_cols if c not in ("entry_date", "entry_date_new")]
    select_cols = ", ".join(cols_without_old) + ", entry_date_new AS entry_date"
    insert_cols = ", ".join(cols_without_old) + ", entry_date"

    await conn.execute(text(
        f"CREATE TABLE journal_entries_backup AS SELECT {select_cols} FROM journal_entries"
    ))
    await conn.execute(text("DROP TABLE journal_entries"))
    await conn.execute(text(
        "ALTER TABLE journal_entries_backup RENAME TO journal_entries"
    ))

    # 重建索引
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_date "
        "ON journal_entries(book_id, entry_date)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_type "
        "ON journal_entries(book_id, entry_type)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_book_reconciliation "
        "ON journal_entries(book_id, reconciliation_status)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_journal_entries_entry_date "
        "ON journal_entries(entry_date)"
    ))
