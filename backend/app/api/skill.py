"""QwenPaw Skill API：与 Web 端相同的后端流水线，一次性跑完解析 + 笔记生成。"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.db.models import Paper, User, utc_now
from app.db.session import get_engine, get_session
from app.schemas.events import StreamEvent
from app.schemas.paper import PaperSummary
from app.schemas.skill import SkillAskRequest, SkillAskResponse, SkillProcessResponse
from app.services.chat_pipeline import get_or_create_conversation, run_chat_turn
from app.services.mineru import count_pdf_pages, paper_data_dir
from app.services.note_export import (
    _embed_images_in_markdown,
    build_note_pdf,
    build_note_zip,
    save_note_pdf,
)
from app.services.note_pipeline import run_note_pipeline
from app.services.parse_time import parse_elapsed_seconds
from app.services.parse_worker import run_parse_pipeline

router = APIRouter(prefix="/api/skill", tags=["skill"])


def _to_summary(p: Paper, user_id: int) -> PaperSummary:
    from pathlib import Path as PathLib

    note_path = paper_data_dir(user_id, p.id) / "note.md"
    has_note = note_path.exists() and note_path.stat().st_size > 0
    return PaperSummary(
        id=p.id,
        title=p.title,
        author=p.author or "",
        status=p.status,
        total_pages=p.total_pages,
        parsed_pages=p.parsed_pages,
        parse_elapsed_seconds=parse_elapsed_seconds(p),
        error_message=p.error_message,
        created_at=p.created_at,
        has_note=has_note,
        summary=p.summary or "",
        thumbnail_url=(
            f"/api/papers/{p.id}/thumbnail?v=2"
            if p.pdf_path and PathLib(p.pdf_path).exists()
            else None
        ),
        cover_url=(
            f"/api/papers/{p.id}/cover?v=1"
            if p.cover_status == "done" and p.cover_path and PathLib(p.cover_path).exists()
            else None
        ),
        cover_status=p.cover_status or "",
    )


@router.get("/info")
def skill_info():
    settings = get_settings()
    return {
        "name": "yanxi-skill",
        "description": "QwenPaw Skill 集成：完整 MinerU 解析 + 火山方舟笔记流水线（含联网检索与 gen_figure）",
        "skill_doc": "integrations/qwenpaw-skill/README.md",
        "qwenpaw_repo": "https://github.com/agentscope-ai/QwenPaw",
        "qwenpaw_skills_doc": "https://github.com/agentscope-ai/QwenPaw/blob/main/website/public/docs/skills.zh.md",
        "api_key_configured": bool((settings.yanxi_api_key or "").strip()),
        "endpoints": {
            "process": "POST /api/skill/process — 上传 PDF，等待解析+笔记完成",
            "note_pdf": "GET /api/skill/papers/{id}/note/export/pdf — 带内嵌图片的 PDF",
            "note_zip": "GET /api/skill/papers/{id}/note/export/zip — 含 note.html+图片（PDF 失败时兜底）",
            "ask": "POST /api/skill/papers/{id}/ask — 论文问答（同步，含联网）",
            "note": "GET /api/skill/papers/{id}/note — 获取 Markdown 笔记",
        },
    }


@router.post("/process", response_model=SkillProcessResponse)
async def skill_process_paper(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    file: UploadFile = File(...),
):
    """上传 PDF 并同步执行与 Web 端相同的解析 + 笔记流水线，返回完整笔记正文。

    笔记生成走 note_pipeline（大纲 → 分章并行起草含 web_search/gen_figure → 综合重写），
    与在研析网页点击「生成解读笔记」一致，不会截断或由 QwenPaw 自行改写。
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "仅支持 PDF 文件")

    paper = Paper(user_id=user.id, title=file.filename, status="uploading")
    session.add(paper)
    session.commit()
    session.refresh(paper)

    data_dir = paper_data_dir(user.id, paper.id)
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = data_dir / "source.pdf"

    async with aiofiles.open(pdf_path, "wb") as out:
        content = await file.read()
        await out.write(content)

    paper.pdf_path = str(pdf_path)
    paper.total_pages = count_pdf_pages(pdf_path)
    paper.parse_started_at = utc_now()
    paper.parse_finished_at = None
    paper.status = "parsing"
    session.add(paper)
    session.commit()
    session.refresh(paper)

    paper_id = paper.id
    user_id = user.id

    await run_parse_pipeline(paper_id, user_id)

    with Session(get_engine()) as check_session:
        paper = check_session.get(Paper, paper_id)
        if not paper:
            raise HTTPException(500, "论文记录丢失")
        if paper.status == "failed":
            raise HTTPException(
                500, paper.error_message or "PDF 解析失败"
            )
        if paper.status != "parsed":
            raise HTTPException(
                500, f"解析未成功完成，当前状态: {paper.status}"
            )

    await run_note_pipeline(paper_id, user_id, regenerate=True)

    with Session(get_engine()) as final_session:
        paper = final_session.get(Paper, paper_id)
        if not paper:
            raise HTTPException(500, "论文记录丢失")
        if paper.status == "failed":
            raise HTTPException(
                500, paper.error_message or "笔记生成失败"
            )
        if paper.status != "done":
            raise HTTPException(
                500, f"笔记未成功完成，当前状态: {paper.status}"
            )

    note_path = paper_data_dir(user_id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(500, "笔记文件不存在")

    note_text = note_path.read_text(encoding="utf-8")
    if not note_text.strip():
        raise HTTPException(500, "笔记内容为空")

    _, embedded, missing = _embed_images_in_markdown(note_text, data_dir)

    pdf_available = False
    pdf_error = ""
    try:
        save_note_pdf(data_dir, paper.title)
        pdf_available = True
    except Exception as e:
        pdf_error = str(e)

    return SkillProcessResponse(
        paper_id=paper_id,
        title=paper.title,
        status=paper.status,
        note=note_text,
        note_length=len(note_text),
        total_pages=paper.total_pages,
        pdf_available=pdf_available,
        pdf_path=str(data_dir / "note_export.pdf") if pdf_available else "",
        pdf_error=pdf_error,
        images_embedded=embedded,
        images_missing=missing,
        pdf_export_path=f"/api/skill/papers/{paper_id}/note/export/pdf",
        zip_export_path=f"/api/skill/papers/{paper_id}/note/export/zip",
    )


@router.get("/papers", response_model=list[PaperSummary])
def skill_list_papers(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    papers = session.exec(
        select(Paper).where(Paper.user_id == user.id).order_by(Paper.created_at.desc())
    ).all()
    return [_to_summary(p, user.id) for p in papers]


@router.get("/papers/{paper_id}/note")
def skill_get_note(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(note_path.read_text(encoding="utf-8"), media_type="text/plain")


@router.get("/papers/{paper_id}/note/export/pdf")
def skill_export_note_pdf(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    """导出带内嵌图片的解读笔记 PDF（图片从本地磁盘或 MinerU zip 解析）。"""
    from fastapi.responses import Response

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    data_dir = paper_data_dir(user.id, paper_id)
    cached = data_dir / "note_export.pdf"
    try:
        if cached.is_file() and cached.stat().st_size > 128:
            content = cached.read_bytes()
            if not content.startswith(b"%PDF"):
                content = build_note_pdf(data_dir, paper.title)
                cached.write_bytes(content)
        else:
            content = build_note_pdf(data_dir, paper.title)
            cached.write_bytes(content)
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except Exception as e:
        raise HTTPException(500, f"PDF 导出失败: {e}") from e
    if not content.startswith(b"%PDF"):
        raise HTTPException(500, "PDF 生成结果无效，请尝试 zip 导出")
    filename = f"{Path(paper.title).stem or 'note'}-note.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/papers/{paper_id}/note/export/zip")
def skill_export_note_zip(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    """导出 zip：note.md + note.html（内嵌 base64 图片）+ 图片文件。"""
    from fastapi.responses import Response

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    data_dir = paper_data_dir(user.id, paper_id)
    try:
        content = build_note_zip(data_dir, paper.title)
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except Exception as e:
        raise HTTPException(500, f"ZIP 导出失败: {e}") from e
    if not content:
        raise HTTPException(500, "ZIP 导出结果为空")
    filename = f"{Path(paper.title).stem or 'note'}-markdown.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/papers/{paper_id}/ask", response_model=SkillAskResponse)
async def skill_ask_paper(
    paper_id: int,
    body: SkillAskRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status not in ("done", "parsed", "noting"):
        raise HTTPException(400, "论文尚未就绪，请先完成解析与笔记生成")

    if body.conversation_id is not None:
        from app.db.models import Conversation

        conv = session.get(Conversation, body.conversation_id)
        if not conv or conv.paper_id != paper_id:
            raise HTTPException(404, "会话不存在")
        conversation_id = conv.id
    else:
        conv = get_or_create_conversation(session, paper_id)
        conversation_id = conv.id

    settings = get_settings()
    model = body.model or (settings.model_list[0] if settings.model_list else "")

    content_parts: list[str] = []
    thinking_parts: list[str] = []
    references: list = []
    error: str | None = None

    async def emit(ev: StreamEvent) -> None:
        nonlocal error
        if ev.type == "content" and ev.data.get("delta"):
            content_parts.append(ev.data["delta"])
        elif ev.type == "thinking" and ev.data.get("delta"):
            thinking_parts.append(ev.data["delta"])
        elif ev.type == "references" and ev.data.get("items"):
            references.extend(ev.data["items"])
        elif ev.type == "status" and ev.data.get("status") == "failed":
            error = ev.data.get("error") or "问答失败"

    await run_chat_turn(
        paper_id=paper_id,
        user_id=user.id,
        conversation_id=conversation_id,
        user_text=body.question.strip(),
        model=model,
        enable_thinking=body.enable_thinking,
        enable_search=body.enable_search,
        attachments=[],
        emit=emit,
    )

    if error:
        raise HTTPException(500, error)

    return SkillAskResponse(
        paper_id=paper_id,
        question=body.question.strip(),
        answer="".join(content_parts).strip(),
        thinking="".join(thinking_parts).strip() or None,
        references=references,
        model=model,
    )
