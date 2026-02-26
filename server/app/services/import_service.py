"""微信账单导入 Service"""

import json
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_task import ImportTask
from app.models.journal import JournalEntry, JournalLine
from app.models.user import User
from app.parsers.wechat import parse_wechat_xlsx
from app.schemas.import_task import (
    ImportConfirmEntryGroup,
    ImportConfirmResponse,
    ImportDeleteResponse,
    ImportRowItem,
    ImportUploadResponse,
    ImportFilters,
    ImportSummary,
)
from app.services.batch_entry_service import _validate_book_access, _find_by_external_id
from app.services.entry_service import create_expense, create_income, create_transfer


# ─── 上传并解析 ─────────────────────────

async def upload_and_parse(
    db: AsyncSession,
    user: User,
    book_id: str,
    file: UploadFile,
) -> ImportUploadResponse:
    """上传微信账单 xlsx，解析并返回预览"""

    # 1. 校验账本权限
    await _validate_book_access(db, book_id, user)

    # 2. 校验文件
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "仅支持 .xlsx 格式")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "文件大小不能超过 10MB")

    # 3. 解析
    try:
        parsed_rows = parse_wechat_xlsx(content)
    except ValueError as e:
        raise HTTPException(422, str(e))

    if not parsed_rows:
        raise HTTPException(422, "解析后无有效交易记录")

    # 4. 标记重复
    for row in parsed_rows:
        existing = await _find_by_external_id(db, book_id, row["external_id"])
        row["is_duplicate"] = existing is not None

    # 5. 构建筛选维度
    directions = sorted(set(r["direction"] for r in parsed_rows))
    payment_methods = sorted(set(
        r["payment_method"] for r in parsed_rows
        if r["payment_method"] != "/"
    ))

    # 6. 构建汇总
    income_rows = [r for r in parsed_rows if r["direction"] == "收入"]
    expense_rows = [r for r in parsed_rows if r["direction"] == "支出"]
    neutral_rows = [r for r in parsed_rows if r["direction"] == "中性交易"]
    duplicate_rows = [r for r in parsed_rows if r["is_duplicate"]]

    summary = ImportSummary(
        income_count=len(income_rows),
        income_total=sum(Decimal(str(r["amount"])) for r in income_rows),
        expense_count=len(expense_rows),
        expense_total=sum(Decimal(str(r["amount"])) for r in expense_rows),
        neutral_count=len(neutral_rows),
        neutral_total=sum(Decimal(str(r["amount"])) for r in neutral_rows),
        duplicate_count=len(duplicate_rows),
    )

    # 7. 创建 ImportTask 记录
    task = ImportTask(
        book_id=book_id,
        user_id=user.id,
        format="wechat",
        original_filename=file.filename or "unknown.xlsx",
        total_rows=len(parsed_rows),
        status="parsed",
        parsed_data=json.dumps(parsed_rows, ensure_ascii=False, default=str),
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    # 8. 构建响应
    rows = [
        ImportRowItem(
            index=i,
            date=r["date"],
            description=r["description"],
            amount=Decimal(str(r["amount"])),
            direction=r["direction"],
            payment_method=r["payment_method"],
            external_id=r["external_id"],
            is_duplicate=r["is_duplicate"],
        )
        for i, r in enumerate(parsed_rows)
    ]

    return ImportUploadResponse(
        task_id=task.id,
        format="wechat",
        total_rows=len(parsed_rows),
        rows=rows,
        filters=ImportFilters(directions=directions, payment_methods=payment_methods),
        summary=summary,
        status="parsed",
    )


# ─── 确认导入 ─────────────────────────

async def confirm_import(
    db: AsyncSession,
    user: User,
    book_id: str,
    task_id: str,
    entry_groups: list[ImportConfirmEntryGroup],
) -> ImportConfirmResponse:
    """分批确认导入，为所选行创建分录"""

    # 1. 获取 task
    task = await _get_task(db, task_id, book_id, user.id)
    if task.status == "failed":
        raise HTTPException(400, "该导入任务已失败，无法继续导入")

    parsed_data = json.loads(task.parsed_data)

    imported_count = 0
    skipped_count = 0

    for group in entry_groups:
        for idx in group.indexes:
            if idx < 0 or idx >= len(parsed_data):
                raise HTTPException(400, f"行索引 {idx} 超出范围")

            row = parsed_data[idx]
            external_id = row["external_id"]

            # 幂等：检查是否已导入
            existing = await _find_by_external_id(db, book_id, external_id)
            if existing:
                skipped_count += 1
                continue

            # 根据 direction 创建分录
            amount = Decimal(str(row["amount"]))
            entry_date_str = row["date"]
            description = row["description"]

            # 将日期字符串转为 datetime 对象
            try:
                entry_date = datetime.fromisoformat(entry_date_str)
            except (ValueError, TypeError):
                entry_date = datetime.strptime(entry_date_str[:19], "%Y-%m-%dT%H:%M:%S")

            try:
                if row["direction"] == "支出":
                    if not group.expense_account_id:
                        raise HTTPException(
                            422, f"支出行 {idx} 需要 expense_account_id"
                        )
                    if not group.payment_account_id:
                        raise HTTPException(
                            422, f"支出行 {idx} 需要 payment_account_id"
                        )
                    entry = await create_expense(
                        db, book_id, user.id,
                        entry_date, amount,
                        group.expense_account_id,
                        group.payment_account_id,
                        description, None,
                    )

                elif row["direction"] == "收入":
                    if not group.income_account_id:
                        raise HTTPException(
                            422, f"收入行 {idx} 需要 income_account_id"
                        )
                    if not group.payment_account_id:
                        raise HTTPException(
                            422, f"收入行 {idx} 需要 payment_account_id"
                        )
                    entry = await create_income(
                        db, book_id, user.id,
                        entry_date, amount,
                        group.income_account_id,
                        group.payment_account_id,
                        description, None,
                    )

                elif row["direction"] == "中性交易":
                    if not group.from_account_id or not group.to_account_id:
                        raise HTTPException(
                            422,
                            f"中性交易行 {idx} 需要 from_account_id 和 to_account_id",
                        )
                    entry = await create_transfer(
                        db, book_id, user.id,
                        entry_date, amount,
                        group.from_account_id,
                        group.to_account_id,
                        description, None,
                    )
                else:
                    raise HTTPException(400, f"未知 direction: {row['direction']}")

                # 设置元数据
                entry.external_id = external_id
                entry.source = "import"
                await db.flush()
                imported_count += 1

            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    400, f"行 {idx} 导入失败: {str(e)}"
                )

    # 更新 task 状态
    task.imported_rows = (task.imported_rows or 0) + imported_count
    task.skipped_rows = (task.skipped_rows or 0) + skipped_count

    total_confirmed = task.imported_rows
    if total_confirmed >= task.total_rows:
        task.status = "imported"
    elif total_confirmed > 0:
        task.status = "partial"

    # 记录本次科目映射
    existing_config = json.loads(task.config) if task.config else []
    existing_config.append({
        "confirmed_at": datetime.utcnow().isoformat(),
        "groups": [g.model_dump() for g in entry_groups],
    })
    task.config = json.dumps(existing_config, ensure_ascii=False)

    await db.flush()

    return ImportConfirmResponse(
        task_id=task.id,
        status=task.status,
        imported_rows=imported_count,
        skipped_rows=skipped_count,
        total_confirmed=total_confirmed,
    )


# ─── 导入历史 ─────────────────────────

async def get_import_history(
    db: AsyncSession, book_id: str, user_id: str
) -> list[ImportTask]:
    """获取导入历史"""
    stmt = (
        select(ImportTask)
        .where(
            ImportTask.book_id == book_id,
            ImportTask.user_id == user_id,
        )
        .order_by(ImportTask.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ─── 撤销导入 ─────────────────────────

async def delete_import(
    db: AsyncSession,
    user: User,
    book_id: str,
    task_id: str,
) -> ImportDeleteResponse:
    """撤销导入：删除该 task 关联的所有分录"""
    task = await _get_task(db, task_id, book_id, user.id)

    # 读取 parsed_data 获取所有 external_id
    parsed_data = json.loads(task.parsed_data) if task.parsed_data else []
    external_ids = [
        row["external_id"] for row in parsed_data if row.get("external_id")
    ]

    # 批量删除 — 先删 journal_lines 再删 journal_entries
    if external_ids:
        # 查找所有关联的分录
        entries_stmt = select(JournalEntry.id).where(
            JournalEntry.book_id == book_id,
            JournalEntry.external_id.in_(external_ids),
        )
        entry_ids_result = await db.execute(entries_stmt)
        entry_ids = [row[0] for row in entry_ids_result.fetchall()]

        if entry_ids:
            # 删除 journal_lines
            await db.execute(
                delete(JournalLine).where(JournalLine.entry_id.in_(entry_ids))
            )
            # 删除 journal_entries
            await db.execute(
                delete(JournalEntry).where(JournalEntry.id.in_(entry_ids))
            )

        deleted_count = len(entry_ids)
    else:
        deleted_count = 0

    # 更新 task 状态
    task.status = "parsed"  # 回到初始状态
    task.imported_rows = 0
    task.skipped_rows = 0
    task.config = None
    await db.flush()

    return ImportDeleteResponse(deleted_count=deleted_count)


# ─── 内部辅助 ─────────────────────────

async def _get_task(
    db: AsyncSession, task_id: str, book_id: str, user_id: str
) -> ImportTask:
    stmt = select(ImportTask).where(
        ImportTask.id == task_id,
        ImportTask.book_id == book_id,
        ImportTask.user_id == user_id,
    )
    task = (await db.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "导入任务不存在")
    return task
