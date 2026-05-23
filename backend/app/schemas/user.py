from pydantic import BaseModel, Field


class UserProfileOut(BaseModel):
    id: int
    username: str
    display_name: str
    account_code: str
    avatar_url: str | None = None
    created_at: str


class UserProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)
