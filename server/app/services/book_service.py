from fastapi import HTTPException
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


async def get_user_books_with_role(db: AsyncSession, user_id: str) -> list[dict]:
    """获取用户账本列表，附带角色信息"""
    result = await db.execute(
        select(Book, BookMember.role)
        .join(BookMember, Book.id == BookMember.book_id)
        .where(BookMember.user_id == user_id)
        .order_by(Book.created_at)
    )
    return [
        {
            "id": book.id,
            "name": book.name,
            "type": book.type,
            "owner_id": book.owner_id,
            "created_at": book.created_at,
            "role": role,
        }
        for book, role in result.all()
    ]


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


# ──────────── 权限检查 ────────────


async def get_member_role(
    db: AsyncSession, user_id: str, book_id: str
) -> str | None:
    """返回用户在账本中的角色：'admin' / 'member' / None"""
    result = await db.execute(
        select(BookMember.role).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def require_admin(
    db: AsyncSession, user_id: str, book_id: str
) -> None:
    """非 admin 则抛出 403"""
    role = await get_member_role(db, user_id, book_id)
    if role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")


async def require_member(
    db: AsyncSession, user_id: str, book_id: str
) -> None:
    """非成员则抛出 403"""
    role = await get_member_role(db, user_id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")


# ──────────── 账本 CRUD ────────────


async def update_book(db: AsyncSession, book_id: str, name: str) -> Book | None:
    """更新账本名称"""
    book = await get_book_by_id(db, book_id)
    if not book:
        return None
    book.name = name
    await db.flush()
    await db.refresh(book)
    return book


async def delete_book(db: AsyncSession, book_id: str) -> None:
    """删除账本（级联删除所有关联数据）"""
    book = await get_book_by_id(db, book_id)
    if book:
        await db.delete(book)
        await db.flush()


# ──────────── 成员管理 ────────────


async def get_book_members(db: AsyncSession, book_id: str) -> list[dict]:
    """获取账本成员列表"""
    from app.models.user import User as UserModel

    result = await db.execute(
        select(BookMember, UserModel)
        .join(UserModel, BookMember.user_id == UserModel.id)
        .where(BookMember.book_id == book_id)
        .order_by(BookMember.role.desc())  # admin 排前面
    )
    book = await get_book_by_id(db, book_id)
    return [
        {
            "user_id": member.user_id,
            "email": user.email,
            "nickname": user.nickname,
            "role": member.role,
            "is_owner": member.user_id == book.owner_id,
        }
        for member, user in result.all()
    ]


async def invite_member(
    db: AsyncSession, book_id: str, email: str, role: str
) -> dict:
    """通过邮箱邀请成员"""
    from app.models.user import User as UserModel

    # 仅家庭账本可邀请成员
    book = await get_book_by_id(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    if book.type != "family":
        raise HTTPException(status_code=400, detail="个人账本不支持邀请成员，请先将账本类型改为家庭账本")

    # 查找用户
    result = await db.execute(
        select(UserModel).where(UserModel.email == email)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="该邮箱未注册，请对方先注册")

    # 检查是否已是成员
    existing = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该用户已是账本成员")

    # 创建成员记录
    member = BookMember(book_id=book_id, user_id=user.id, role=role)
    db.add(member)
    await db.flush()

    book = await get_book_by_id(db, book_id)
    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": role,
        "is_owner": user.id == book.owner_id,
    }


async def remove_member(
    db: AsyncSession, book_id: str, user_id: str
) -> None:
    """移除成员"""
    book = await get_book_by_id(db, book_id)
    if book and book.owner_id == user_id:
        raise HTTPException(status_code=400, detail="不可移除账本创建者")

    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    await db.delete(member)
    await db.flush()


async def update_member_role(
    db: AsyncSession, book_id: str, user_id: str, role: str
) -> dict:
    """修改成员角色"""
    from app.models.user import User as UserModel

    book = await get_book_by_id(db, book_id)
    if book and book.owner_id == user_id:
        raise HTTPException(status_code=400, detail="不可修改账本创建者的角色")

    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    member.role = role
    await db.flush()

    user_result = await db.execute(
        select(UserModel).where(UserModel.id == user_id)
    )
    user = user_result.scalar_one()
    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": role,
        "is_owner": user.id == book.owner_id,
    }


async def leave_book(
    db: AsyncSession, book_id: str, user_id: str
) -> None:
    """退出账本"""
    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.flush()
