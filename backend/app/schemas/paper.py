from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.chat import ChatAttachmentIn


class PaperSummary(BaseModel):
    id: int
    title: str
    author: str = ""
    status: str
    total_pages: int
    parsed_pages: int
    parse_elapsed_seconds: int = 0
    error_message: str
    created_at: datetime
    folder_ids: list[int] = []
    folder_names: list[str] = []
    has_note: bool = False
    thumbnail_url: str | None = None
    summary: str = ""
    note_read_progress: int = 0
    note_last_scroll_top: int = 0
    note_last_read_at: datetime | None = None
    note_read_epoch: int = 0
    cover_url: str | None = None
    cover_status: str = ""


class NoteReadProgressBody(BaseModel):
    progress: int = Field(ge=0, le=100)
    scroll_top: int = Field(ge=0, default=0)
    note_read_epoch: int = Field(ge=0, default=0)


class PaperUpdateBody(BaseModel):
    title: str | None = None
    author: str | None = None
    folder_ids: list[int] | None = None


class PaperDetail(PaperSummary):
    pdf_url: str
    markdown_url: str | None = None
    has_markdown: bool = False
    has_markdown_translation: bool = False
    note_url: str | None = None
    has_note: bool = False
    note_version: int = 0
    note_model: str = ""
    note_model_label: str = ""


class MarkdownTranslateBody(BaseModel):
    model: str = "deepseek-v4-flash"


class NoteRegenerateBody(BaseModel):
    model: str = ""
    image_model: str = "ark"


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


class NoteSectionAddFigureBody(BaseModel):
    heading: str
    instruction: str = ""
    image_model: str = "ark"


class NoteDeleteFigureBody(BaseModel):
    image_path: str


class NoteSectionRefineBody(BaseModel):
    heading: str
    instruction: str
    model: str = ""
    enable_thinking: bool = True
    enable_search: bool = False
    attachments: list[ChatAttachmentIn] = Field(default_factory=list)


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
