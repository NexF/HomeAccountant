"""固定资产 Pydantic Schema"""

from datetime import date, datetime
from pydantic import BaseModel, Field


class AssetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    account_id: str
    purchase_date: date
    original_cost: float = Field(..., gt=0)
    residual_rate: float = Field(5.0, ge=0, le=100)
    useful_life_months: int = Field(..., gt=0)
    depreciation_method: str = Field("straight_line", pattern=r"^(straight_line|none)$")
    depreciation_granularity: str = Field("monthly", pattern=r"^(monthly|daily)$")


class AssetUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    residual_rate: float | None = Field(None, ge=0, le=100)
    useful_life_months: int | None = Field(None, gt=0)
    depreciation_method: str | None = Field(None, pattern=r"^(straight_line|none)$")
    depreciation_granularity: str | None = Field(None, pattern=r"^(monthly|daily)$")


class AssetResponse(BaseModel):
    id: str
    book_id: str
    account_id: str
    account_name: str
    name: str
    purchase_date: date
    original_cost: float
    residual_rate: float
    useful_life_months: int
    depreciation_method: str
    depreciation_granularity: str
    accumulated_depreciation: float
    net_book_value: float
    period_depreciation: float
    remaining_months: int
    depreciation_percentage: float
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AssetDispose(BaseModel):
    disposal_income: float = Field(..., ge=0)
    disposal_date: date
    income_account_id: str


class AssetSummary(BaseModel):
    total_original_cost: float
    total_accumulated_depreciation: float
    total_net_book_value: float
    asset_count: int
    active_count: int


class DepreciationRecord(BaseModel):
    period: str
    amount: float
    accumulated: float
    net_value: float
    entry_id: str | None
