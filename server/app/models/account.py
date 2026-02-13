import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Boolean, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(
        SAEnum("asset", "liability", "equity", "income", "expense", name="account_type"),
        nullable=False,
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id")
    )
    balance_direction: Mapped[str] = mapped_column(
        SAEnum("debit", "credit", name="balance_direction"), nullable=False
    )
    icon: Mapped[str | None] = mapped_column(String(50))
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    has_external_source: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    # 关联
    book = relationship("Book", back_populates="accounts")
    parent = relationship("Account", remote_side="Account.id", backref="children")
    journal_lines = relationship("JournalLine", back_populates="account")
