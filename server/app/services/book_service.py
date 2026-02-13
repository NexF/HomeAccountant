from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookMember
from app.utils.seed import seed_accounts_for_book


async def create_book(
    db: AsyncSession,
    owner_id: str,
    name: str,
    book_type: str = "personal",
    auto_seed: bool = True,
) -> Book:
    """创建账本，默认自动灌入预置科目"""
    book = Book(name=name, type=book_type, owner_id=owner_id)
    db.add(book)
    await db.flush()

    # owner 也加入 book_members（admin 角色）
    member = BookMember(book_id=book.id, user_id=owner_id, role="admin")
    db.add(member)

    if auto_seed:
        await seed_accounts_for_book(db, book.id)

    await db.flush()
    await db.refresh(book)
    return book


async def get_user_books(db: AsyncSession, user_id: str) -> list[Book]:
    """获取用户拥有或参与的账本"""
    result = await db.execute(
        select(Book)
        .join(BookMember, Book.id == BookMember.book_id)
        .where(BookMember.user_id == user_id)
        .order_by(Book.created_at)
    )
    return list(result.scalars().all())


async def get_book_by_id(db: AsyncSession, book_id: str) -> Book | None:
    result = await db.execute(select(Book).where(Book.id == book_id))
    return result.scalar_one_or_none()


async def user_has_book_access(db: AsyncSession, user_id: str, book_id: str) -> bool:
    """检查用户是否有权访问该账本"""
    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None
