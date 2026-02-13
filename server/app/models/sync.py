import uuid
from datetime import datetime, date

from sqlalchemy import (
    String, DateTime, Date, ForeignKey, Numeric, JSON,
    Enum as SAEnum, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(
        SAEnum(
            "manual", "csv_import", "open_banking", "broker_api", "exchange_api",
            name="source_type",
        ),
        nullable=False,
    )
    provider_name: Mapped[str | None] = mapped_column(String(200))
    config: Mapped[dict | None] = mapped_column(JSON)
    sync_frequency: Mapped[str] = mapped_column(
        SAEnum("manual", "daily", "realtime", name="sync_frequency"),
        default="manual",
    )
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(
        SAEnum("active", "disconnected", "error", name="source_status"),
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关联
    book = relationship("Book")
    account = relationship("Account")
    snapshots = relationship("BalanceSnapshot", back_populates="data_source", cascade="all, delete-orphan")


class BalanceSnapshot(Base):
    __tablename__ = "balance_snapshots"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    data_source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("data_sources.id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), nullable=False
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    external_balance: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    book_balance: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    difference: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("balanced", "pending", "reconciled", name="snapshot_status"),
        default="pending",
    )
    reconciliation_entry_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("journal_entries.id")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关联
    data_source = relationship("DataSource", back_populates="snapshots")
    account = relationship("Account")
    reconciliation_entry = relationship("JournalEntry")


class ExternalTransaction(Base):
    __tablename__ = "external_transactions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    data_source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("data_sources.id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), nullable=False
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    counterparty: Mapped[str | None] = mapped_column(String(200))
    matched_entry_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("journal_entries.id")
    )
    match_status: Mapped[str] = mapped_column(
        SAEnum("unmatched", "matched", "reconciled", name="match_status"),
        default="unmatched",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关联
    data_source = relationship("DataSource")
    account = relationship("Account")
    matched_entry = relationship("JournalEntry")
