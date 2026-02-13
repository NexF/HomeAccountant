from datetime import datetime

from pydantic import BaseModel, Field


class CreateBookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field("personal", pattern=r"^(personal|family)$")


class BookResponse(BaseModel):
    id: str
    name: str
    type: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
