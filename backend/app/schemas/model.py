from datetime import datetime

from pydantic import BaseModel, Field


class ModelOptionOut(BaseModel):
    id: str
    label: str
    source: str


class ModelListOut(BaseModel):
    models: list[ModelOptionOut]
    default_model: str


class UserModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    api_url: str = Field(min_length=1, max_length=512)
    api_key: str = Field(min_length=1, max_length=512)


class UserModelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    api_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_key: str | None = Field(default=None, min_length=1, max_length=512)


class UserModelOut(BaseModel):
    id: int
    name: str
    api_url: str
    created_at: datetime
