from datetime import date
from pydantic import BaseModel


class SnapshotCreateRequest(BaseModel):
    external_balance: float
    snapshot_date: date | None = None
    adjust_account_id: str | None = None


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
