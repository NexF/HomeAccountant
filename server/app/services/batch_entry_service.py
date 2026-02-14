"""批量记账 Service — 在单个事务中批量创建分录，支持 external_id 去重"""

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, BookMember
from app.models.journal import JournalEntry
from app.models.user import User
from app.schemas.plugin import BatchEntryItem, BatchEntryResultItem, BatchEntryResponse
from app.services.entry_service import (
    create_expense,
    create_income,
    create_asset_purchase,
    create_borrow,
    create_repayment,
    create_transfer,
    EntryError,
)


async def _validate_book_access(db: AsyncSession, book_id: str, user: User) -> Book:
    """校验 book 归属并返回 Book 对象"""
    result = await db.execute(
        select(Book).where(Book.id == book_id)
    )
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "账本不存在")

    member = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user.id,
        )
    )
    if not member.scalar_one_or_none():
        raise HTTPException(403, "无权访问该账本")

    return book


async def _find_by_external_id(
    db: AsyncSession, book_id: str, external_id: str
) -> JournalEntry | None:
    """按 book_id + external_id 查找已有分录"""
    result = await db.execute(
        select(JournalEntry).where(
            JournalEntry.book_id == book_id,
            JournalEntry.external_id == external_id,
        )
    )
    return result.scalar_one_or_none()


async def _create_single_entry(
    db: AsyncSession, user: User, book: Book, item: BatchEntryItem
) -> JournalEntry:
    """复用现有 entry_service 的分录创建逻辑（不含联动实体创建）"""
    match item.entry_type:
        case "expense":
            if not item.amount or not item.category_account_id or not item.payment_account_id:
                raise EntryError("费用分录需要 amount, category_account_id, payment_account_id")
            return await create_expense(
                db, book.id, user.id, item.entry_date, item.amount,
                item.category_account_id, item.payment_account_id,
                item.description, item.note,
            )
        case "income":
            if not item.amount or not item.category_account_id or not item.payment_account_id:
                raise EntryError("收入分录需要 amount, category_account_id, payment_account_id")
            return await create_income(
                db, book.id, user.id, item.entry_date, item.amount,
                item.category_account_id, item.payment_account_id,
                item.description, item.note,
            )
        case "transfer":
            if not item.amount or not item.from_account_id or not item.to_account_id:
                raise EntryError("转账需要 amount, from_account_id, to_account_id")
            return await create_transfer(
                db, book.id, user.id, item.entry_date, item.amount,
                item.from_account_id, item.to_account_id,
                item.description, item.note,
            )
        case "asset_purchase":
            if not item.amount or not item.asset_account_id or not item.payment_account_id:
                raise EntryError("购买资产需要 amount, asset_account_id, payment_account_id")
            entry, _ = await create_asset_purchase(
                db, book.id, user.id, item.entry_date, item.amount,
                item.asset_account_id, item.payment_account_id,
                item.description, item.note,
                item.extra_liability_account_id, item.extra_liability_amount,
            )
            return entry
        case "borrow":
            if not item.amount or not item.payment_account_id or not item.liability_account_id:
                raise EntryError("借入需要 amount, payment_account_id, liability_account_id")
            return await create_borrow(
                db, book.id, user.id, item.entry_date, item.amount,
                item.payment_account_id, item.liability_account_id,
                item.description, item.note,
            )
        case "repay":
            if item.principal is None or item.interest is None:
                raise EntryError("还款需要 principal, interest")
            if not item.liability_account_id or not item.payment_account_id:
                raise EntryError("还款需要 liability_account_id, payment_account_id")
            return await create_repayment(
                db, book.id, user.id, item.entry_date,
                item.principal, item.interest,
                item.liability_account_id, item.payment_account_id,
                item.category_account_id,
                item.description, item.note,
            )
        case _:
            raise ValueError(f"批量导入不支持的分录类型: {item.entry_type}")


async def batch_create_entries(
    db: AsyncSession,
    user: User,
    book_id: str,
    entries: list[BatchEntryItem],
) -> BatchEntryResponse:
    """批量创建分录，事务性保证。

    - external_id 重复的条目自动跳过
    - 任何一条失败则整体抛异常，由 router 层回滚事务
    """
    book = await _validate_book_access(db, book_id, user)

    results: list[BatchEntryResultItem] = []
    created_count = 0
    skipped_count = 0

    for idx, item in enumerate(entries):
        # 1. external_id 去重
        if item.external_id:
            existing = await _find_by_external_id(db, book_id, item.external_id)
            if existing:
                results.append(BatchEntryResultItem(
                    index=idx,
                    external_id=item.external_id,
                    status="skipped",
                    entry_id=existing.id,
                ))
                skipped_count += 1
                continue

        # 2. 创建分录
        try:
            entry = await _create_single_entry(db, user, book, item)

            # 3. 设置 external_id 和 source
            if item.external_id:
                entry.external_id = item.external_id
            entry.source = "sync"
            await db.flush()

            results.append(BatchEntryResultItem(
                index=idx,
                external_id=item.external_id,
                status="created",
                entry_id=entry.id,
            ))
            created_count += 1

        except EntryError as e:
            raise HTTPException(400, detail=f"第 {idx + 1} 条分录创建失败: {e.detail}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, detail=f"第 {idx + 1} 条分录创建失败: {str(e)}")

    return BatchEntryResponse(
        total=len(entries),
        created=created_count,
        skipped=skipped_count,
        results=results,
    )
