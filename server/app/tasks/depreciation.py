"""月度 & 每日自动折旧定时任务"""

import logging
from datetime import date, timedelta

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.asset import FixedAsset
from app.services.depreciation_service import (
    depreciate_all_active,
)

logger = logging.getLogger(__name__)


async def run_monthly_depreciation():
    """
    每月 1 日凌晨执行
    为所有账本中 granularity=monthly 的活跃资产生成上月折旧分录
    """
    today = date.today()
    # 上月的期间标签，如 "2026-01"
    last_month = (today.replace(day=1) - timedelta(days=1))
    period_label = last_month.strftime("%Y-%m")

    logger.info(f"[月度折旧] 开始执行，期间: {period_label}")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FixedAsset.book_id)
            .where(
                FixedAsset.status == "active",
                FixedAsset.depreciation_method == "straight_line",
            )
            .distinct()
        )
        book_ids = [row[0] for row in result.all()]

        total_entries = 0
        for book_id in book_ids:
            try:
                # 使用系统用户 ID（第一个用户）
                entries = await depreciate_all_active(
                    db, book_id, period_label, "monthly", "system"
                )
                total_entries += len(entries)
            except Exception as e:
                logger.error(f"[月度折旧] 账本 {book_id} 失败: {e}")

        await db.commit()
        logger.info(f"[月度折旧] 完成，共生成 {total_entries} 条折旧分录")


async def run_daily_depreciation():
    """
    每日凌晨执行
    为所有账本中 granularity=daily 的活跃资产生成前一日折旧分录
    """
    yesterday = date.today() - timedelta(days=1)
    period_label = yesterday.strftime("%Y-%m-%d")

    logger.info(f"[每日折旧] 开始执行，期间: {period_label}")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(FixedAsset.book_id)
            .where(
                FixedAsset.status == "active",
                FixedAsset.depreciation_method == "straight_line",
            )
            .distinct()
        )
        book_ids = [row[0] for row in result.all()]

        total_entries = 0
        for book_id in book_ids:
            try:
                entries = await depreciate_all_active(
                    db, book_id, period_label, "daily", "system"
                )
                total_entries += len(entries)
            except Exception as e:
                logger.error(f"[每日折旧] 账本 {book_id} 失败: {e}")

        await db.commit()
        logger.info(f"[每日折旧] 完成，共生成 {total_entries} 条折旧分录")
