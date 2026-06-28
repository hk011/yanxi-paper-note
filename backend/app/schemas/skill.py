from pydantic import BaseModel, Field


class SkillProcessResponse(BaseModel):
    paper_id: int
    title: str
    status: str
    note: str
    note_length: int
    total_pages: int = 0
    pdf_available: bool = False
    pdf_path: str = ""
    pdf_error: str = ""
    images_embedded: int = 0
    images_missing: int = 0
    pdf_export_path: str = ""
    zip_export_path: str = ""
    message: str = (
        "完整解读笔记已生成。请下载 pdf_export_path 对应的 PDF（内嵌图片），"
        "勿自行用 Markdown 拼 PDF。"
    )


class SkillAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    model: str = ""
    enable_search: bool = True
    enable_thinking: bool = False
    conversation_id: int | None = None


class SkillAskResponse(BaseModel):
    paper_id: int
    question: str
    answer: str
    thinking: str | None = None
    references: list = Field(default_factory=list)
    model: str = ""
