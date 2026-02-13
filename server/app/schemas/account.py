from datetime import datetime

from pydantic import BaseModel, Field


class CreateAccountRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., pattern=r"^(asset|liability|equity|income|expense)$")
    parent_id: str | None = None
    balance_direction: str = Field(..., pattern=r"^(debit|credit)$")
    icon: str | None = None
    sort_order: int = 0


class UpdateAccountRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    icon: str | None = None
    sort_order: int | None = None


class AccountResponse(BaseModel):
    id: str
    book_id: str
    code: str
    name: str
    type: str
    parent_id: str | None
    balance_direction: str
    icon: str | None
    is_system: bool
    sort_order: int
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AccountTreeNode(BaseModel):
    id: str
    book_id: str
    code: str
    name: str
    type: str
    parent_id: str | None
    balance_direction: str
    icon: str | None
    is_system: bool
    sort_order: int
    is_active: bool
    created_at: datetime
    children: list["AccountTreeNode"] = []

    model_config = {"from_attributes": True}


class AccountTreeResponse(BaseModel):
    asset: list[AccountTreeNode] = []
    liability: list[AccountTreeNode] = []
    equity: list[AccountTreeNode] = []
    income: list[AccountTreeNode] = []
    expense: list[AccountTreeNode] = []
