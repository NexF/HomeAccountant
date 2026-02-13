import uuid
from datetime import datetime, date

from sqlalchemy import String, DateTime, Date, ForeignKey, Integer, Numeric, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Loan(Base):
    __tablename__ = "loans"

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
    principal: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    remaining_principal: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    annual_rate: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    total_months: Mapped[int] = mapped_column(Integer, nullable=False)
    repaid_months: Mapped[int] = mapped_column(Integer, default=0)
    monthly_payment: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    repayment_method: Mapped[str] = mapped_column(
        SAEnum("equal_installment", "equal_principal", name="repayment_method"),
        nullable=False,
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("active", "paid_off", name="loan_status"),
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    # 关联
    account = relationship("Account")
