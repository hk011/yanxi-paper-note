from datetime import datetime

from pydantic import BaseModel, Field


class ModelOptionOut(BaseModel):
    id: str
    label: str
    source: str


class ImageModelOptionOut(BaseModel):
    id: str
    label: str
    hint: str
    available: bool


class ModelListOut(BaseModel):
    models: list[ModelOptionOut]
    default_model: str
    mcp_search_available: bool = False
    image_models: list[ImageModelOptionOut] = Field(default_factory=list)


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
