from datetime import datetime

from pydantic import BaseModel


class PaperSummary(BaseModel):
    id: int
    title: str
    status: str
    total_pages: int
    parsed_pages: int
    parse_elapsed_seconds: int = 0
    error_message: str
    created_at: datetime


class PaperDetail(PaperSummary):
    pdf_url: str
    markdown_url: str | None = None
    has_markdown: bool = False
    note_url: str | None = None
    has_note: bool = False
    note_version: int = 0
    note_model: str = ""
    note_model_label: str = ""


class NoteRegenerateBody(BaseModel):
    model: str = ""


class NoteUpdateBody(BaseModel):
    content: str


class NoteRefineRequest(BaseModel):
    conversation_id: int
    scope: str = "turn"  # turn | conversation
    intent: str = "refine"  # refine | expand | compare | summarize
    assistant_message_id: int | None = None
    model: str = ""


class NoteRefineApplyBody(BaseModel):
    content: str
    model: str = ""
    conversation_id: int | None = None
    assistant_message_id: int | None = None


class NoteVersionSummary(BaseModel):
    version: int
    model: str = ""
    created_at: datetime | None = None
    is_current: bool = False


class NoteVersionListOut(BaseModel):
    items: list[NoteVersionSummary]
    current_version: int


class NoteVersionRestoreBody(BaseModel):
    version: int
