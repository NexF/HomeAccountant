from datetime import datetime

from pydantic import BaseModel, Field


class CreateBookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field("personal", pattern=r"^(personal|family)$")


class UpdateBookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class InviteMemberRequest(BaseModel):
    email: str = Field(..., description="被邀请人的注册邮箱")
    role: str = Field("member", pattern=r"^(admin|member)$")


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(..., pattern=r"^(admin|member)$")


class BookMemberResponse(BaseModel):
    user_id: str
    email: str
    nickname: str | None
    role: str           # admin / member
    is_owner: bool      # user_id == book.owner_id

    model_config = {"from_attributes": True}


class BookResponse(BaseModel):
    id: str
    name: str
    type: str
    owner_id: str
    created_at: datetime
    role: str = ""  # 当前用户在此账本中的角色

    model_config = {"from_attributes": True}
