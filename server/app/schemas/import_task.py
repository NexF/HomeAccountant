from datetime import datetime
from decimal import Decimal
from typing import Literal, Any

from pydantic import BaseModel, Field


# ─── 上传解析响应 ─────────────────────────

class ImportRowItem(BaseModel):
    index: int
    date: str
    description: str
    amount: Decimal = Field(description="金额（正数），方向由 direction 表达")
    direction: Literal["支出", "收入", "中性交易"]
    payment_method: str
    external_id: str
    is_duplicate: bool = False


class ImportFilters(BaseModel):
    directions: list[str]
    payment_methods: list[str]


class ImportSummary(BaseModel):
    income_count: int
    income_total: Decimal
    expense_count: int
    expense_total: Decimal
    neutral_count: int
    neutral_total: Decimal
    duplicate_count: int


class ImportUploadResponse(BaseModel):
    task_id: str
    format: str
    total_rows: int
    rows: list[ImportRowItem]
    filters: ImportFilters
    summary: ImportSummary
    status: str


# ─── 确认导入请求 ─────────────────────────

class ImportConfirmEntryGroup(BaseModel):
    indexes: list[int] = Field(..., description="行索引列表")
    expense_account_id: str | None = Field(None, description="支出费用科目")
    income_account_id: str | None = Field(None, description="收入科目")
    payment_account_id: str | None = Field(None, description="支付/收款资产科目（支出/收入时必填）")
    from_account_id: str | None = Field(None, description="中性交易转出资产科目")
    to_account_id: str | None = Field(None, description="中性交易转入资产科目")


class ImportConfirmRequest(BaseModel):
    entries: list[ImportConfirmEntryGroup] = Field(
        ..., description="分组数组，每组包含行索引和目标科目"
    )


class ImportConfirmResponse(BaseModel):
    task_id: str
    status: str
    imported_rows: int
    skipped_rows: int
    total_confirmed: int


# ─── 导入历史响应 ─────────────────────────

class ImportHistoryItem(BaseModel):
    id: str
    format: str
    original_filename: str
    total_rows: int
    imported_rows: int
    skipped_rows: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── 撤销导入响应 ─────────────────────────

class ImportDeleteResponse(BaseModel):
    deleted_count: int
