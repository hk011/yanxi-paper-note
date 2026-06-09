from datetime import datetime

from pydantic import BaseModel


class FolderCreateBody(BaseModel):
    name: str
    parent_id: int | None = None


class FolderUpdateBody(BaseModel):
    name: str | None = None
    parent_id: int | None = None


class FolderOut(BaseModel):
    id: int
    name: str
    parent_id: int | None
    paper_count: int = 0
    children: list["FolderOut"] = []
    created_at: datetime


FolderOut.model_rebuild()
