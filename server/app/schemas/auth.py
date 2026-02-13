from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# ---- 请求 ----

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128, description="密码（6-128位）")
    nickname: str | None = Field(None, max_length=100, description="昵称")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdateRequest(BaseModel):
    nickname: str | None = Field(None, max_length=100, description="昵称")
    avatar_url: str | None = Field(None, max_length=500, description="头像URL")
    currency: str | None = Field(None, max_length=10, description="货币代码")


# ---- 响应 ----

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="过期时间（秒）")


class UserResponse(BaseModel):
    id: str
    email: str
    nickname: str | None
    avatar_url: str | None
    currency: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    user: UserResponse
    token: TokenResponse


class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None
