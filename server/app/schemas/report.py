from datetime import date
from pydantic import BaseModel


class AccountBalanceItem(BaseModel):
    account_id: str
    account_code: str
    account_name: str
    account_type: str
    balance_direction: str
    parent_id: str | None
    debit_total: float
    credit_total: float
    balance: float


class BalanceSheetResponse(BaseModel):
    as_of_date: str
    assets: list[AccountBalanceItem]
    liabilities: list[AccountBalanceItem]
    equities: list[AccountBalanceItem]
    net_income: float
    total_asset: float
    total_liability: float
    total_equity: float
    adjusted_equity: float
    is_balanced: bool


class IncomeStatementResponse(BaseModel):
    start_date: str
    end_date: str
    incomes: list[AccountBalanceItem]
    expenses: list[AccountBalanceItem]
    total_income: float
    total_expense: float
    net_income: float


class RecentEntryItem(BaseModel):
    id: str
    book_id: str
    user_id: str
    entry_date: str
    entry_type: str
    description: str | None
    note: str | None
    is_balanced: bool
    source: str
    created_at: str | None
    updated_at: str | None
    net_worth_impact: float = 0.0


class DashboardResponse(BaseModel):
    net_asset: float
    prev_net_asset: float
    net_asset_change: float
    total_asset: float
    total_liability: float
    month_income: float
    month_expense: float
    month_net_income: float
    recent_entries: list[RecentEntryItem]


class NetWorthTrendPoint(BaseModel):
    date: str
    label: str
    net_asset: float
    total_asset: float
    total_liability: float


class BreakdownItem(BaseModel):
    account_id: str
    account_code: str
    account_name: str
    amount: float
    percentage: float
