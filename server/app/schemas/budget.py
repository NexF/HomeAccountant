from datetime import datetime

from pydantic import BaseModel, Field


class BudgetCreate(BaseModel):
    account_id: str | None = None  # NULL = 总预算
    amount: float = Field(gt=0)
    alert_threshold: float = Field(default=0.80, ge=0, le=1.0)


class BudgetUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    alert_threshold: float | None = Field(default=None, ge=0, le=1.0)
    is_active: bool | None = None


class BudgetResponse(BaseModel):
    id: str
    book_id: str
    account_id: str | None
    account_name: str | None = None
    amount: float
    period: str
    alert_threshold: float
    is_active: bool
    # 当月使用情况（实时计算）
    used_amount: float = 0
    usage_rate: float = 0
    remaining: float = 0
    status: str = "normal"  # normal / warning / exceeded
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class BudgetOverview(BaseModel):
    total_budget: float | None = None
    total_used: float = 0
    total_usage_rate: float | None = None
    total_status: str = "not_set"  # normal / warning / exceeded / not_set
    category_budgets: list[BudgetResponse] = []


class BudgetAlert(BaseModel):
    budget_id: str
    account_name: str | None = None
    budget_amount: float
    used_amount: float
    usage_rate: float
    alert_type: str  # warning / exceeded
    message: str


class BudgetCheckResult(BaseModel):
    triggered: bool = False
    alerts: list[BudgetAlert] = []
