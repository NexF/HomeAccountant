from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.import_task import (
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportDeleteResponse,
    ImportHistoryItem,
    ImportUploadResponse,
)
from app.services import import_service
from app.utils.deps import get_current_user

router = APIRouter(prefix="/books/{book_id}/import", tags=["Import"])


@router.post("/upload", response_model=ImportUploadResponse)
async def upload_and_parse(
    book_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传微信账单 xlsx 文件并解析预览"""
    return await import_service.upload_and_parse(db, user, book_id, file)


@router.post("/{task_id}/confirm", response_model=ImportConfirmResponse)
async def confirm_import(
    book_id: str,
    task_id: str,
    body: ImportConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """确认导入选中的行（支持分批多次调用）"""
    return await import_service.confirm_import(
        db, user, book_id, task_id, body.entries
    )


@router.get("/history", response_model=list[ImportHistoryItem])
async def get_history(
    book_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取导入历史"""
    return await import_service.get_import_history(db, book_id, user.id)


@router.delete("/{task_id}", response_model=ImportDeleteResponse)
async def delete_import(
    book_id: str,
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """撤销导入：删除该任务关联的所有分录"""
    return await import_service.delete_import(db, user, book_id, task_id)
