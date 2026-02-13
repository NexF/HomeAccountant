from datetime import date
from pydantic import BaseModel


class SnapshotCreateRequest(BaseModel):
    external_balance: float
    snapshot_date: date | None = None


class SnapshotResponse(BaseModel):
    snapshot_id: str
    account_id: str
    account_name: str
    account_type: str
    snapshot_date: str
    external_balance: float
    book_balance: float
    difference: float
    status: str
    reconciliation_entry_id: str | None


class ReconcileLineItem(BaseModel):
    id: str
    account_id: str
    account_name: str | None
    account_code: str | None
    account_type: str | None
    debit_amount: float
    credit_amount: float


class ReconcileSnapshotInfo(BaseModel):
    snapshot_id: str
    account_id: str
    snapshot_date: str
    external_balance: float
    book_balance: float
    difference: float


class PendingReconcileItem(BaseModel):
    entry_id: str
    entry_date: str
    description: str | None
    lines: list[ReconcileLineItem]
    snapshot: ReconcileSnapshotInfo | None
    created_at: str | None


class ConfirmRequest(BaseModel):
    target_account_id: str


class ConfirmResponse(BaseModel):
    entry_id: str
    reconciliation_status: str
    target_account_id: str
    target_account_name: str


class SplitItem(BaseModel):
    account_id: str
    amount: float
    description: str | None = None


class SplitRequest(BaseModel):
    splits: list[SplitItem]


class SplitResponse(BaseModel):
    entry_id: str
    reconciliation_status: str
    splits_count: int


class PendingCountResponse(BaseModel):
    count: int
