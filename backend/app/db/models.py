from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    display_name: str = ""
    account_code: str = Field(default="", index=True)
    avatar_path: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class Paper(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = "未命名论文"
    status: str = "uploading"  # uploading|parsing|parsed|noting|done|failed
    pdf_path: str = ""
    mineru_task_id: str = ""
    mineru_zip_path: str = ""
    markdown_path: str = ""
    total_pages: int = 0
    parsed_pages: int = 0
    parse_started_at: datetime | None = None
    parse_finished_at: datetime | None = None
    error_message: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class Note(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    paper_id: int = Field(index=True)
    version: int = 1
    md_path: str = ""
    model: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    paper_id: int = Field(index=True)
    kind: str = ""  # mineru_image | ai_generated
    path: str = ""
    meta_json: str = "{}"
    created_at: datetime = Field(default_factory=utc_now)


class Conversation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    paper_id: int = Field(index=True)
    title: str = "论文问答"
    kind: str = "qa"  # qa | note_edit
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class UserModel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    name: str = Field(index=True)
    api_url: str
    api_key: str
    created_at: datetime = Field(default_factory=utc_now)


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(index=True)
    role: str = ""  # user | assistant
    content: str = ""
    reasoning_content: str = ""
    had_tool_call: bool = False
    references_json: str = "[]"
    tool_trace_json: str = "[]"
    attachments_json: str = "[]"
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    created_at: datetime = Field(default_factory=utc_now)
