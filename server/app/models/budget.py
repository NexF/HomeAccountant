import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, Numeric, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id")
    )
    amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    period: Mapped[str] = mapped_column(String(20), default="monthly")

    # v0.0.2 新增字段
    alert_threshold: Mapped[float] = mapped_column(
        Numeric(3, 2), default=0.80
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 关联
    book = relationship("Book")
    account = relationship("Account")
