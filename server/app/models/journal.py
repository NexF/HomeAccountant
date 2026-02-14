import uuid
from datetime import datetime, date

from sqlalchemy import (
    String, DateTime, Date, ForeignKey, Boolean, Text,
    Numeric, JSON, Enum as SAEnum, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        Index("ix_journal_entries_book_date", "book_id", "entry_date"),
        Index("ix_journal_entries_book_type", "book_id", "entry_type"),
        Index("ix_journal_entries_book_reconciliation", "book_id", "reconciliation_status"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    entry_type: Mapped[str] = mapped_column(
        SAEnum(
            "expense", "income", "asset_purchase", "asset_dispose", "borrow",
            "repay", "transfer", "depreciation", "reconciliation", "manual",
            name="entry_type",
        ),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(String(500))
    note: Mapped[str | None] = mapped_column(Text)
    image_urls: Mapped[dict | None] = mapped_column(JSON)
    is_balanced: Mapped[bool] = mapped_column(Boolean, default=True)
    reconciliation_status: Mapped[str] = mapped_column(
        SAEnum("none", "pending", "confirmed", name="reconciliation_status"),
        default="none",
    )
    source: Mapped[str] = mapped_column(
        SAEnum("manual", "sync", "reconciliation", name="entry_source"),
        default="manual",
    )
    external_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="外部唯一标识，用于幂等去重"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 关联
    book = relationship("Book", back_populates="journal_entries")
    user = relationship("User")
    lines = relationship("JournalLine", back_populates="entry", cascade="all, delete-orphan")


class JournalLine(Base):
    __tablename__ = "journal_lines"
    __table_args__ = (
        Index("ix_journal_lines_account_entry", "account_id", "entry_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    entry_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("journal_entries.id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), nullable=False, index=True
    )
    debit_amount: Mapped[float] = mapped_column(
        Numeric(15, 2), default=0
    )
    credit_amount: Mapped[float] = mapped_column(
        Numeric(15, 2), default=0
    )
    description: Mapped[str | None] = mapped_column(String(500))

    # 关联
    entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("Account", back_populates="journal_lines")
