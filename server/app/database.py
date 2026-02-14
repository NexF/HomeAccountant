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
