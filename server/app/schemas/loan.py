"""贷款管理 Pydantic Schema"""

from datetime import date, datetime
from pydantic import BaseModel, Field


class LoanCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    account_id: str = Field(..., description="负债科目 ID")
    principal: float = Field(..., gt=0, description="贷款本金")
    annual_rate: float = Field(..., ge=0, le=100, description="年利率(%)")
    total_months: int = Field(..., gt=0, description="还款总期数(月)")
    repayment_method: str = Field(
        "equal_installment",
        pattern=r"^(equal_installment|equal_principal)$",
        description="等额本息 / 等额本金",
    )
    start_date: date = Field(..., description="首次还款日期")
    deposit_account_id: str | None = Field(None, description="放款到资产账户 ID，提供则自动生成借款入账分录")


class LoanUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    annual_rate: float | None = Field(None, ge=0, le=100)


class LoanResponse(BaseModel):
    id: str
    book_id: str
    account_id: str
    account_name: str
    name: str
    principal: float
    remaining_principal: float
    annual_rate: float
    total_months: int
    repaid_months: int
    monthly_payment: float
    repayment_method: str
    start_date: date
    status: str
    total_interest: float
    created_at: datetime

    model_config = {"from_attributes": True}


class LoanSummary(BaseModel):
    total_principal: float
    total_remaining: float
    total_paid_principal: float
    total_interest_paid: float
    loan_count: int
    active_count: int


class RepaymentScheduleItem(BaseModel):
    period: int
    payment_date: date
    payment: float
    principal: float
    interest: float
    remaining: float
    is_paid: bool


class LoanRepayRequest(BaseModel):
    payment_account_id: str = Field(..., description="还款资产账户 ID")
    interest_account_id: str | None = Field(None, description="利息费用科目 ID")
    repay_date: date | None = Field(None, description="还款日期，默认今天")


class LoanPrepayRequest(BaseModel):
    amount: float = Field(..., gt=0, description="提前还款金额")
    payment_account_id: str = Field(..., description="还款资产账户 ID")
    interest_account_id: str | None = Field(None, description="利息费用科目 ID")
    prepay_date: date | None = Field(None, description="还款日期，默认今天")
