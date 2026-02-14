from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class JournalLineCreate(BaseModel):
    """手动分录行（manual 类型使用）"""
    account_id: str
    debit_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")
    description: str | None = None


class EntryCreateRequest(BaseModel):
    """创建分录的统一入口"""
    entry_type: str = Field(
        ...,
        pattern=r"^(expense|income|asset_purchase|borrow|repay|transfer|manual)$",
    )
    entry_date: date
    description: str | None = Field(None, max_length=500)
    note: str | None = None

    # --- 简易模式字段（expense / income / asset_purchase / borrow / repay / transfer）---
    amount: Decimal | None = Field(None, gt=0, description="主金额")

    # 费用/收入
    category_account_id: str | None = Field(None, description="费用/收入科目 ID")
    payment_account_id: str | None = Field(None, description="支付/收款 资产/负债科目 ID")

    # 购买资产
    asset_account_id: str | None = Field(None, description="目标资产科目 ID")

    # 借入/贷款
    liability_account_id: str | None = Field(None, description="负债科目 ID")

    # 还款
    principal: Decimal | None = Field(None, ge=0, description="本金")
    interest: Decimal | None = Field(None, ge=0, description="利息")

    # 转账
    from_account_id: str | None = Field(None, description="来源账户")
    to_account_id: str | None = Field(None, description="目标账户")

    # 买房等多贷方：额外负债
    extra_liability_account_id: str | None = Field(None, description="额外负债科目 ID（如贷款买房）")
    extra_liability_amount: Decimal | None = Field(None, ge=0, description="额外负债金额")

    # 折旧设置（仅 asset_purchase + 固定资产科目时使用）
    asset_name: str | None = Field(None, max_length=200, description="资产名称")
    useful_life_months: int | None = Field(None, gt=0, description="使用寿命（月）")
    residual_rate: Decimal | None = Field(None, ge=0, le=100, description="残值率（%）")
    depreciation_method: str | None = Field(
        None, pattern=r"^(straight_line|none)$", description="折旧方式"
    )
    depreciation_granularity: str | None = Field(
        None, pattern=r"^(monthly|daily)$", description="折旧粒度"
    )

    # --- 贷款设置（borrow 类型可选，填写后自动创建贷款记录）---
    loan_name: str | None = Field(None, max_length=200, description="贷款名称")
    annual_rate: float | None = Field(None, ge=0, le=100, description="年利率(%)")
    total_months: int | None = Field(None, gt=0, description="还款总期数(月)")
    repayment_method: str | None = Field(
        None, pattern=r"^(equal_installment|equal_principal)$", description="还款方式"
    )
    start_date: date | None = Field(None, description="首次还款日期")

    # --- 手动模式 ---
    lines: list[JournalLineCreate] | None = None

    # --- v0.2.0 外部去重 ---
    external_id: str | None = Field(None, max_length=128, description="外部唯一标识，用于去重")


class EntryUpdateRequest(BaseModel):
    """分录完整编辑请求 — 除 entry_type 外，所有业务字段均可修改"""

    # 元数据
    entry_date: date | None = None
    description: str | None = Field(None, max_length=500)
    note: str | None = None

    # 金额
    amount: Decimal | None = Field(None, gt=0)

    # 科目 ID
    category_account_id: str | None = None
    payment_account_id: str | None = None
    asset_account_id: str | None = None
    liability_account_id: str | None = None
    from_account_id: str | None = None
    to_account_id: str | None = None
    extra_liability_account_id: str | None = None
    extra_liability_amount: Decimal | None = Field(None, ge=0)

    # repay 专用
    principal: Decimal | None = Field(None, ge=0)
    interest: Decimal | None = Field(None, ge=0)

    # manual 专用
    lines: list[JournalLineCreate] | None = None


class JournalLineResponse(BaseModel):
    id: str
    entry_id: str
    account_id: str
    debit_amount: Decimal
    credit_amount: Decimal
    description: str | None

    # 附带科目信息方便前端展示和反向推导
    account_name: str | None = None
    account_code: str | None = None
    account_type: str | None = None

    model_config = {"from_attributes": True}


class EntryResponse(BaseModel):
    id: str
    book_id: str
    user_id: str
    entry_date: date
    entry_type: str
    description: str | None
    note: str | None
    is_balanced: bool
    source: str
    created_at: datetime
    updated_at: datetime
    net_worth_impact: float = 0.0  # 对净资产的影响金额（正=增加，负=减少）

    model_config = {"from_attributes": True}


class EntryDetailResponse(EntryResponse):
    lines: list[JournalLineResponse] = []
    asset_id: str | None = None  # 如果同时创建了固定资产记录


class EntryListResponse(BaseModel):
    items: list[EntryResponse]
    total: int
    page: int
    page_size: int


class EntryConvertRequest(BaseModel):
    """分录类型转换请求"""
    target_type: Literal["expense", "income", "transfer", "asset_purchase", "borrow", "repay"]
    category_account_id: str | None = None  # 新类型需要的分类科目
    payment_account_id: str | None = None   # 新类型需要的支付科目
