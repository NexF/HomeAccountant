from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.book import CreateBookRequest, BookResponse
from app.services.book_service import create_book, get_user_books
from app.utils.deps import get_current_user

router = APIRouter(prefix="/books", tags=["账本"])


@router.post("", response_model=BookResponse, status_code=201, summary="创建账本")
async def create(
    body: CreateBookRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建账本并自动灌入预置科目"""
    book = await create_book(db, current_user.id, body.name, body.type)
    return BookResponse.model_validate(book)


@router.get("", response_model=list[BookResponse], summary="获取账本列表")
async def list_books(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户拥有或参与的所有账本"""
    books = await get_user_books(db, current_user.id)
    return [BookResponse.model_validate(b) for b in books]
