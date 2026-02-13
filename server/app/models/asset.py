import uuid
from datetime import datetime, date

from sqlalchemy import String, DateTime, Date, ForeignKey, Numeric, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FixedAsset(Base):
    __tablename__ = "fixed_assets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id"), nullable=False, index=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    original_cost: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    residual_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=5.00)
    useful_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    depreciation_method: Mapped[str] = mapped_column(
        SAEnum("straight_line", "none", name="depreciation_method"),
        default="straight_line",
    )
    depreciation_granularity: Mapped[str] = mapped_column(
        String(10), default="monthly"
    )
    accumulated_depreciation: Mapped[float] = mapped_column(
        Numeric(15, 2), default=0
    )
    status: Mapped[str] = mapped_column(
        SAEnum("active", "disposed", name="asset_status"),
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关联
    book = relationship("Book")
    account = relationship("Account")
