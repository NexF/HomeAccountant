from datetime import datetime, timedelta

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.book import Book, BookMember
from app.models.journal import JournalEntry


async def get_stats(db: AsyncSession) -> dict:
    """聚合查询系统概览统计"""
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    # 用户统计
    user_stats = await db.execute(
        select(
            func.count(User.id).label("total"),
            func.count(case((User.is_active == True, 1))).label("active"),  # noqa: E712
            func.count(case((User.is_active == False, 1))).label("banned"),  # noqa: E712
        )
    )
    u = user_stats.one()

    # 账本统计
    book_stats = await db.execute(
        select(
            func.count(Book.id).label("total"),
            func.count(case((Book.type == "personal", 1))).label("personal"),
            func.count(case((Book.type == "family", 1))).label("family"),
        )
    )
    b = book_stats.one()

    # 分录总数
    entry_total = await db.execute(select(func.count(JournalEntry.id)))

    # 今日新增用户
    today_users = await db.execute(
        select(func.count(User.id)).where(User.created_at >= today_start)
    )

    # 今日新增分录
    today_entries = await db.execute(
        select(func.count(JournalEntry.id)).where(JournalEntry.created_at >= today_start)
    )

    # 7 天活跃用户（有 last_active_at 且在 7 天内）
    weekly_active = await db.execute(
        select(func.count(User.id)).where(
            and_(User.last_active_at.isnot(None), User.last_active_at >= week_ago)
        )
    )

    return {
        "total_users": u.total,
        "active_users": u.active,
        "banned_users": u.banned,
        "total_books": b.total,
        "personal_books": b.personal,
        "family_books": b.family,
        "total_entries": entry_total.scalar(),
        "today_new_users": today_users.scalar(),
        "today_new_entries": today_entries.scalar(),
        "weekly_active_users": weekly_active.scalar(),
    }


async def list_users(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
    status: str | None = None,
) -> tuple[list[dict], int]:
    """用户分页列表，返回 (items, total)"""
    # 子查询：每用户的账本数
    book_count_sub = (
        select(Book.owner_id, func.count(Book.id).label("book_count"))
        .group_by(Book.owner_id)
        .subquery()
    )

    query = (
        select(User, func.coalesce(book_count_sub.c.book_count, 0).label("book_count"))
        .outerjoin(book_count_sub, User.id == book_count_sub.c.owner_id)
    )

    count_query = select(func.count(User.id))

    # 搜索过滤
    if search:
        like = f"%{search}%"
        search_filter = User.email.ilike(like) | User.nickname.ilike(like)
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # 状态过滤
    if status == "active":
        query = query.where(User.is_active == True)  # noqa: E712
        count_query = count_query.where(User.is_active == True)  # noqa: E712
    elif status == "banned":
        query = query.where(User.is_active == False)  # noqa: E712
        count_query = count_query.where(User.is_active == False)  # noqa: E712

    # 总数
    total = (await db.execute(count_query)).scalar()

    # 分页
    query = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)

    items = []
    for user, book_count in result.all():
        items.append({
            "id": user.id,
            "email": user.email,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "is_active": user.is_active,
            "book_count": book_count,
            "created_at": user.created_at,
            "last_active_at": user.last_active_at,
        })

    return items, total


async def get_user_detail(db: AsyncSession, user_id: str) -> dict | None:
    """单用户详情"""
    book_count_sub = (
        select(func.count(Book.id)).where(Book.owner_id == user_id).scalar_subquery()
    )
    result = await db.execute(
        select(User, book_count_sub.label("book_count")).where(User.id == user_id)
    )
    row = result.one_or_none()
    if not row:
        return None
    user, book_count = row
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "is_active": user.is_active,
        "book_count": book_count,
        "created_at": user.created_at,
        "last_active_at": user.last_active_at,
    }


async def update_user(db: AsyncSession, user_id: str, nickname: str | None) -> dict | None:
    """修改用户昵称"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    if nickname is not None:
        user.nickname = nickname
    await db.flush()
    return await get_user_detail(db, user_id)


async def ban_user(db: AsyncSession, user_id: str) -> dict | None:
    """封禁用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    user.is_active = False
    await db.flush()
    return await get_user_detail(db, user_id)


async def unban_user(db: AsyncSession, user_id: str) -> dict | None:
    """解封用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    user.is_active = True
    await db.flush()
    return await get_user_detail(db, user_id)


async def list_books(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
) -> tuple[list[dict], int]:
    """账本分页列表"""
    # 子查询：成员数
    member_count_sub = (
        select(BookMember.book_id, func.count(BookMember.user_id).label("member_count"))
        .group_by(BookMember.book_id)
        .subquery()
    )
    # 子查询：分录数
    entry_count_sub = (
        select(JournalEntry.book_id, func.count(JournalEntry.id).label("entry_count"))
        .group_by(JournalEntry.book_id)
        .subquery()
    )

    query = (
        select(
            Book,
            User.email.label("owner_email"),
            User.nickname.label("owner_nickname"),
            func.coalesce(member_count_sub.c.member_count, 0).label("member_count"),
            func.coalesce(entry_count_sub.c.entry_count, 0).label("entry_count"),
        )
        .join(User, Book.owner_id == User.id)
        .outerjoin(member_count_sub, Book.id == member_count_sub.c.book_id)
        .outerjoin(entry_count_sub, Book.id == entry_count_sub.c.book_id)
    )

    count_query = select(func.count(Book.id))

    if search:
        like = f"%{search}%"
        search_filter = Book.name.ilike(like) | User.email.ilike(like) | User.nickname.ilike(like)
        query = query.where(search_filter)
        count_query = (
            select(func.count(Book.id))
            .join(User, Book.owner_id == User.id)
            .where(search_filter)
        )

    total = (await db.execute(count_query)).scalar()

    query = query.order_by(Book.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)

    items = []
    for book, owner_email, owner_nickname, member_count, entry_count in result.all():
        items.append({
            "id": book.id,
            "name": book.name,
            "type": book.type,
            "owner_email": owner_email,
            "owner_nickname": owner_nickname,
            "member_count": member_count,
            "entry_count": entry_count,
            "created_at": book.created_at,
        })

    return items, total
