import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(
        SAEnum("personal", "family", name="book_type"), default="personal"
    )
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    # 关联
    owner = relationship("User", back_populates="books")
    members = relationship("BookMember", back_populates="book", cascade="all, delete-orphan")
    accounts = relationship("Account", back_populates="book", cascade="all, delete-orphan")
    journal_entries = relationship("JournalEntry", back_populates="book", cascade="all, delete-orphan")


class BookMember(Base):
    __tablename__ = "book_members"

    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), primary_key=True
    )
    role: Mapped[str] = mapped_column(
        SAEnum("admin", "member", name="member_role"), default="admin"
    )

    # 关联
    book = relationship("Book", back_populates="members")
    user = relationship("User")
