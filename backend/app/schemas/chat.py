from datetime import datetime

from pydantic import BaseModel, Field


class ModelOptionOut(BaseModel):
    id: str
    label: str
    source: str


class ChatConfigOut(BaseModel):
    models: list[ModelOptionOut]
    default_model: str
    context_limit: int = 256_000
    mcp_search_available: bool = False


class ChatSuggestionItem(BaseModel):
    key: str
    label: str


class ChatSuggestionsOut(BaseModel):
    items: list[ChatSuggestionItem]


class ChatAttachmentIn(BaseModel):
    path: str
    name: str = ""


class ChatSendRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    conversation_id: int | None = None
    model: str = ""
    enable_thinking: bool = True
    enable_search: bool = False
    enable_figure_gen: bool = False
    attachments: list[ChatAttachmentIn] = Field(default_factory=list)


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    reasoning_content: str = ""
    had_tool_call: bool = False
    references: list[dict] = Field(default_factory=list)
    tool_trace: list[dict] = Field(default_factory=list)
    attachments: list[dict] = Field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    created_at: datetime


class ChatConversationOut(BaseModel):
    id: int
    paper_id: int
    title: str
    messages: list[ChatMessageOut] = Field(default_factory=list)


class ChatConversationSummary(BaseModel):
    id: int
    paper_id: int
    title: str
    message_count: int = 0
    preview: str = ""
    created_at: datetime
    updated_at: datetime


class ChatConversationListOut(BaseModel):
    items: list[ChatConversationSummary] = Field(default_factory=list)
    active_id: int | None = None
