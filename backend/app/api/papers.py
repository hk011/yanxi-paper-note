import asyncio
import shutil
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import exists
from sqlmodel import Session, select

from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import decode_token, get_current_user, security
from app.db.models import Asset, Conversation, Message, Note, Paper, PaperFolder, User, utc_now
from app.db.session import get_session
from app.schemas.events import StreamEvent
from app.schemas.paper import (
    NoteRefineApplyBody,
    NoteRefineRequest,
    NoteRegenerateBody,
    NoteDeleteFigureBody,
    NoteSectionAddFigureBody,
    NoteSectionRefineBody,
    NoteUpdateBody,
    NoteVersionListOut,
    NoteVersionRestoreBody,
    NoteVersionSummary,
    MarkdownTranslateBody,
    NoteReadProgressBody,
    PaperDetail,
    PaperSummary,
    PaperUpdateBody,
)
from app.services.folders import (
    get_folder_or_404,
    get_paper_folder_ids,
    paper_folder_meta,
    should_regenerate_card_on_folder_change,
    sync_paper_folders,
)
from app.services.markdown_translate import (
    has_translation,
    load_translation,
    run_translate_markdown_stream,
)
from app.services.thumbnail import ensure_thumbnail
from app.services.model_registry import (
    default_model_key,
    extract_llm_model_key,
    model_label,
    paper_note_model_label,
    resolve_model,
    resolve_note_model_on_save,
)
from app.services.mineru import count_pdf_pages, paper_data_dir
from app.services.parse_time import parse_elapsed_seconds
from app.services.parse_worker import (
    get_parse_queue,
    is_parse_job_active,
    remove_parse_queue,
    reset_parse_queue,
    resume_stuck_parse_jobs,
    run_parse_pipeline,
    schedule_parse_pipeline,
)

router = APIRouter(prefix="/api/papers", tags=["papers"])


def _paper_has_note(user_id: int, paper_id: int) -> bool:
    note_path = paper_data_dir(user_id, paper_id) / "note.md"
    return note_path.exists() and note_path.stat().st_size > 0


def _paper_cover_url(p: Paper) -> str | None:
    if p.cover_status == "done" and p.cover_path and Path(p.cover_path).exists():
        path = Path(p.cover_path)
        v = int(path.stat().st_mtime)
        return f"/api/papers/{p.id}/cover?v={v}"
    return None


def _to_summaries(session: Session, user_id: int, papers: list[Paper]) -> list[PaperSummary]:
    paper_ids = [p.id for p in papers]
    folder_meta = paper_folder_meta(session, paper_ids)
    return [
        PaperSummary(
            id=p.id,
            title=p.title,
            author=p.author or "",
            status=p.status,
            total_pages=p.total_pages,
            parsed_pages=p.parsed_pages,
            parse_elapsed_seconds=parse_elapsed_seconds(p),
            error_message=p.error_message,
            created_at=p.created_at,
            folder_ids=folder_meta.get(p.id, ([], []))[0],
            folder_names=folder_meta.get(p.id, ([], []))[1],
            has_note=_paper_has_note(user_id, p.id),
            thumbnail_url=(
                f"/api/papers/{p.id}/thumbnail?v=2"
                if p.pdf_path and Path(p.pdf_path).exists()
                else None
            ),
            summary=p.summary or "",
            note_read_progress=p.note_read_progress or 0,
            note_last_scroll_top=p.note_last_scroll_top or 0,
            note_last_read_at=p.note_last_read_at,
            note_read_epoch=p.note_read_epoch or 0,
            cover_url=_paper_cover_url(p),
            cover_status=p.cover_status or "",
        )
        for p in papers
    ]


def _to_summary(session: Session, user_id: int, p: Paper) -> PaperSummary:
    return _to_summaries(session, user_id, [p])[0]


def _ensure_total_pages(session: Session, paper: Paper) -> None:
    changed = False
    if paper.total_pages <= 0 and paper.pdf_path:
        path = Path(paper.pdf_path)
        if path.exists():
            total_pages = count_pdf_pages(path)
            if total_pages > 0:
                paper.total_pages = total_pages
                changed = True
    if (
        paper.status in ("parsed", "noting", "done")
        and paper.total_pages > 0
        and paper.parsed_pages < paper.total_pages
    ):
        paper.parsed_pages = paper.total_pages
        changed = True
    if not changed:
        return
    session.add(paper)
    session.commit()
    session.refresh(paper)


@router.get("", response_model=list[PaperSummary])
def list_papers(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    folder_id: int | None = Query(default=None),
    uncategorized: bool = Query(default=False),
    q: str | None = Query(default=None),
    sort: str = Query(default="created_at_desc"),
):
    stmt = select(Paper).where(Paper.user_id == user.id)
    if uncategorized:
        stmt = stmt.where(
            ~exists(
                select(PaperFolder.paper_id).where(PaperFolder.paper_id == Paper.id)
            )
        )
    elif folder_id is not None:
        stmt = stmt.join(PaperFolder, PaperFolder.paper_id == Paper.id).where(
            PaperFolder.folder_id == folder_id
        )
    if q and q.strip():
        keyword = f"%{q.strip()}%"
        stmt = stmt.where((Paper.title.like(keyword)) | (Paper.author.like(keyword)))
    if sort == "title_asc":
        stmt = stmt.order_by(Paper.title.asc())
    else:
        stmt = stmt.order_by(Paper.created_at.desc())
    papers = session.exec(stmt).all()
    for paper in papers:
        _ensure_total_pages(session, paper)
    return _to_summaries(session, user.id, papers)


@router.get("/{paper_id}", response_model=PaperDetail)
def get_paper(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    _ensure_total_pages(session, paper)
    md_url = f"/api/papers/{paper_id}/markdown" if paper.markdown_path else None
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    has_note = note_path.exists() and note_path.stat().st_size > 0
    note = session.exec(
        select(Note).where(Note.paper_id == paper_id).order_by(Note.version.desc())
    ).first()
    stored_model = note.model if note else ""
    if note and not extract_llm_model_key(stored_model):
        repaired = resolve_note_model_on_save(
            "",
            stored_model,
            session=session,
            paper_id=paper_id,
        )
        if extract_llm_model_key(repaired):
            note.model = repaired
            session.add(note)
            session.commit()
            stored_model = repaired
    summary = _to_summary(session, user.id, paper).model_dump()
    return PaperDetail(
        **summary,
        pdf_url=f"/api/papers/{paper_id}/pdf",
        markdown_url=md_url,
        has_markdown=bool(paper.markdown_path and Path(paper.markdown_path).exists()),
        has_markdown_translation=has_translation(user.id, paper_id),
        note_url=f"/api/papers/{paper_id}/note" if has_note else None,
        note_version=note.version if note else 0,
        note_model=stored_model,
        note_model_label=paper_note_model_label(
            session, user.id, paper_id, stored_model
        ),
    )


@router.patch("/{paper_id}", response_model=PaperSummary)
def update_paper(
    paper_id: int,
    body: PaperUpdateBody,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.paper_enrichment import run_paper_enrichment

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    regen_card = False
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "标题不能为空")
        paper.title = title
    if body.author is not None:
        paper.author = body.author.strip()
    if body.folder_ids is not None:
        old_folder_ids = get_paper_folder_ids(session, paper_id)
        sync_paper_folders(session, user.id, paper_id, body.folder_ids)
        new_folder_ids = get_paper_folder_ids(session, paper_id)
        regen_card = should_regenerate_card_on_folder_change(
            old_folder_ids, new_folder_ids
        )
    session.add(paper)
    session.commit()
    session.refresh(paper)
    if (
        regen_card
        and paper.status in ("parsed", "done")
    ):
        paper.summary = ""
        paper.summary_generated_at = None
        paper.cover_status = "generating"
        session.add(paper)
        session.commit()
        session.refresh(paper)
        primary_folder_id = (
            new_folder_ids[0] if len(new_folder_ids) == 1 else None
        )
        background_tasks.add_task(
            run_paper_enrichment,
            paper_id,
            user.id,
            force=True,
            primary_folder_id=primary_folder_id,
        )
    return _to_summary(session, user.id, paper)


@router.patch("/{paper_id}/note-read-progress", response_model=PaperSummary)
def update_note_read_progress(
    paper_id: int,
    body: NoteReadProgressBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")

    server_epoch = paper.note_read_epoch or 0
    client_epoch = body.note_read_epoch
    if client_epoch < server_epoch:
        return _to_summary(session, user.id, paper)

    progress = max(paper.note_read_progress or 0, body.progress)
    scroll_top = body.scroll_top
    if client_epoch == server_epoch:
        scroll_top = max(paper.note_last_scroll_top or 0, body.scroll_top)

    paper.note_read_progress = progress
    paper.note_last_scroll_top = scroll_top
    paper.note_last_read_at = utc_now()
    session.add(paper)
    session.commit()
    session.refresh(paper)
    return _to_summary(session, user.id, paper)


@router.post("/{paper_id}/enrichment", response_model=PaperSummary)
def trigger_paper_enrichment(
    paper_id: int,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    force: bool = Query(default=False),
):
    from app.services.paper_enrichment import run_paper_enrichment

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status not in ("parsed", "done", "noting", "failed"):
        raise HTTPException(400, "论文尚未解析完成")
    if force:
        paper.summary = ""
        paper.summary_generated_at = None
        paper.cover_status = "generating"
        session.add(paper)
        session.commit()
    background_tasks.add_task(run_paper_enrichment, paper_id, user.id, force=force)
    session.refresh(paper)
    return _to_summary(session, user.id, paper)


@router.delete("/{paper_id}", status_code=204)
def delete_paper(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")

    for note in session.exec(select(Note).where(Note.paper_id == paper_id)).all():
        session.delete(note)
    for asset in session.exec(select(Asset).where(Asset.paper_id == paper_id)).all():
        session.delete(asset)
    for link in session.exec(select(PaperFolder).where(PaperFolder.paper_id == paper_id)).all():
        session.delete(link)
    for conv in session.exec(select(Conversation).where(Conversation.paper_id == paper_id)).all():
        for msg in session.exec(
            select(Message).where(Message.conversation_id == conv.id)
        ).all():
            session.delete(msg)
        session.delete(conv)
    session.delete(paper)
    session.commit()

    data_dir = paper_data_dir(user.id, paper_id)
    if data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)

    remove_parse_queue(paper_id)


@router.post("/upload", response_model=PaperSummary)
async def upload_paper(
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    file: UploadFile = File(...),
    folder_id: int | None = Form(default=None),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        from fastapi import HTTPException

        raise HTTPException(400, "仅支持 PDF 文件")

    if folder_id is not None:
        get_folder_or_404(session, user.id, folder_id)

    paper = Paper(user_id=user.id, title=file.filename, status="uploading")
    session.add(paper)
    session.commit()
    session.refresh(paper)

    if folder_id is not None:
        sync_paper_folders(session, user.id, paper.id, [folder_id])
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

    get_parse_queue(paper.id)
    background_tasks.add_task(run_parse_pipeline, paper.id, user.id)
    return _to_summary(session, user.id, paper)


@router.get("/{paper_id}/events")
async def paper_events(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
):
    """SSE 流式事件：不在流式期间持有 DB Session（避免连接池耗尽）。"""
    from fastapi import HTTPException

    from app.db.session import get_engine

    with Session(get_engine()) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user.id:
            raise HTTPException(404, "论文不存在")
        snapshot = {
            "status": paper.status,
            "error_message": paper.error_message,
            "user_id": user.id,
        }

    async def event_generator():
        if snapshot["status"] in ("parsing", "uploading") and not is_parse_job_active(
            paper_id
        ):
            await resume_stuck_parse_jobs()

        status = snapshot["status"]
        if status == "done":
            yield StreamEvent(type="status", data={"status": "done"}).to_sse()
            note_path = paper_data_dir(snapshot["user_id"], paper_id) / "note.md"
            if note_path.exists():
                yield StreamEvent(
                    type="content",
                    data={
                        "delta": note_path.read_text(encoding="utf-8"),
                        "snapshot": True,
                    },
                ).to_sse()
            yield StreamEvent(type="done", data={}).to_sse()
            return
        if status == "failed":
            yield StreamEvent(
                type="status",
                data={"status": "failed", "error": snapshot["error_message"]},
            ).to_sse()
            yield StreamEvent(type="done", data={}).to_sse()
            return
        if status in ("parsed", "noting"):
            yield StreamEvent(type="status", data={"status": status}).to_sse()

        q = get_parse_queue(paper_id)
        received_any = False
        while True:
            timeout = 600.0 if received_any else 8.0
            try:
                event = await asyncio.wait_for(q.get(), timeout=timeout)
            except asyncio.TimeoutError:
                if received_any:
                    break
                # 首次连接时队列可能暂时为空：查库确认是否仍在处理
                with Session(get_engine()) as session:
                    p = session.get(Paper, paper_id)
                    still_running = p and p.status in (
                        "uploading",
                        "parsing",
                        "parsed",
                        "noting",
                    )
                if still_running:
                    continue
                yield StreamEvent(type="done", data={}).to_sse()
                break
            received_any = True
            if event is None:
                yield StreamEvent(type="done", data={}).to_sse()
                break
            yield event.to_sse()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{paper_id}/pdf")
def get_pdf(
    paper_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: str | None = None,
    creds: Annotated[
        HTTPAuthorizationCredentials | None, Depends(security)
    ] = None,
):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    raw_token = creds.credentials if creds else token
    if not raw_token:
        raise HTTPException(401, "请先登录")
    payload = decode_token(raw_token)
    user_id = int(payload["sub"])

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user_id:
        raise HTTPException(404, "论文不存在")
    path = Path(paper.pdf_path)
    if not path.exists():
        raise HTTPException(404, "PDF 不存在")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/{paper_id}/thumbnail")
def get_thumbnail(
    paper_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: str | None = None,
    creds: Annotated[
        HTTPAuthorizationCredentials | None, Depends(security)
    ] = None,
):
    from fastapi.responses import FileResponse

    raw_token = creds.credentials if creds else token
    if not raw_token:
        raise HTTPException(401, "请先登录")
    payload = decode_token(raw_token)
    user_id = int(payload["sub"])

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user_id:
        raise HTTPException(404, "论文不存在")
    thumb = ensure_thumbnail(user_id, paper_id, paper.pdf_path)
    if not thumb:
        raise HTTPException(404, "缩略图不可用")
    return FileResponse(thumb, media_type="image/jpeg", filename="thumbnail.jpg")


@router.get("/{paper_id}/cover")
def get_cover(
    paper_id: int,
    session: Annotated[Session, Depends(get_session)],
    token: str | None = None,
    creds: Annotated[
        HTTPAuthorizationCredentials | None, Depends(security)
    ] = None,
):
    from fastapi.responses import FileResponse

    raw_token = creds.credentials if creds else token
    if not raw_token:
        raise HTTPException(401, "请先登录")
    payload = decode_token(raw_token)
    user_id = int(payload["sub"])

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user_id:
        raise HTTPException(404, "论文不存在")
    if not paper.cover_path or paper.cover_status != "done":
        raise HTTPException(404, "封面不可用")
    path = Path(paper.cover_path)
    if not path.exists():
        raise HTTPException(404, "封面不存在")
    return FileResponse(path, media_type="image/jpeg", filename="cover.jpg")


@router.get("/{paper_id}/note")
def get_note(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi import HTTPException
    from fastapi.responses import PlainTextResponse

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")
    from app.services.note_content import normalize_note_image_refs

    raw = note_path.read_text(encoding="utf-8")
    return PlainTextResponse(
        normalize_note_image_refs(raw, paper_id),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


@router.get("/{paper_id}/note/generation-trace")
def get_note_generation_trace(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi import HTTPException

    from app.services.note_generation_trace import load_generation_trace

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    data_dir = paper_data_dir(user.id, paper_id)
    trace = load_generation_trace(data_dir)
    if not trace:
        raise HTTPException(404, "生成过程记录不存在")
    return trace


@router.put("/{paper_id}/note")
def update_note(
    paper_id: int,
    body: NoteUpdateBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，暂不可编辑")
    if not body.content.strip():
        raise HTTPException(400, "笔记内容不能为空")

    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")

    note_path.write_text(body.content, encoding="utf-8")

    existing_note = session.exec(
        select(Note).where(Note.paper_id == paper_id).order_by(Note.version.desc())
    ).first()
    if existing_note:
        existing_note.md_path = str(note_path)
        session.add(existing_note)
        note_version = existing_note.version
    else:
        note = Note(
            paper_id=paper_id,
            version=1,
            md_path=str(note_path),
            model="manual",
        )
        session.add(note)
        note_version = 1

    session.commit()
    return {"ok": True, "note_version": note_version}


@router.get("/{paper_id}/note/versions", response_model=NoteVersionListOut)
def list_note_versions_api(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_versions import list_note_versions

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    raw = list_note_versions(session, paper_id, user.id)
    items = [NoteVersionSummary(**row) for row in raw]
    current = max((i.version for i in items), default=0)
    return NoteVersionListOut(items=items, current_version=current)


@router.get("/{paper_id}/note/versions/{version}")
def get_note_version_api(
    paper_id: int,
    version: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi.responses import PlainTextResponse

    from app.services.note_versions import get_note_version_content
    from app.services.note_content import normalize_note_image_refs

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    try:
        content = get_note_version_content(session, paper_id, user.id, version)
    except FileNotFoundError:
        raise HTTPException(404, "笔记版本不存在")
    return PlainTextResponse(
        normalize_note_image_refs(content, paper_id), media_type="text/plain"
    )


@router.post("/{paper_id}/note/versions/restore")
def restore_note_version_api(
    paper_id: int,
    body: NoteVersionRestoreBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_refine import apply_refined_note as do_apply
    from app.services.note_versions import get_note_version_content

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，暂不可恢复")
    try:
        content = get_note_version_content(
            session, paper_id, user.id, body.version
        )
    except FileNotFoundError:
        raise HTTPException(404, "笔记版本不存在")
    try:
        return do_apply(
            paper_id=paper_id,
            user_id=user.id,
            content=content,
            model="",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{paper_id}/note/refine")
async def refine_note(
    paper_id: int,
    body: NoteRefineRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_refine import run_note_refine

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，暂不可融合")
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")

    conv = session.get(Conversation, body.conversation_id)
    if not conv or conv.paper_id != paper_id:
        raise HTTPException(404, "会话不存在")

    if body.scope not in ("turn", "conversation"):
        raise HTTPException(400, "scope 须为 turn 或 conversation")
    if body.intent not in ("refine", "expand", "compare", "summarize"):
        raise HTTPException(400, "intent 无效")
    if body.scope == "turn" and not body.assistant_message_id:
        raise HTTPException(400, "单轮融合须指定 assistant_message_id")

    try:
        endpoint = resolve_model(session, user.id, body.model or "")
        model_key = endpoint.key
    except ValueError as e:
        raise HTTPException(400, str(e))

    async def event_generator():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def emit(ev: StreamEvent) -> None:
            await queue.put(ev)

        async def worker() -> None:
            try:
                await run_note_refine(
                    paper_id=paper_id,
                    user_id=user.id,
                    conversation_id=body.conversation_id,
                    scope=body.scope,
                    intent=body.intent,
                    assistant_message_id=body.assistant_message_id,
                    model=model_key,
                    emit=emit,
                )
            except Exception as e:
                await emit(
                    StreamEvent(type="status", data={"status": "failed", "error": str(e)})
                )
                await emit(StreamEvent(type="done", data={}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(worker())
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield ev.to_sse()
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{paper_id}/note/repair-gen-figures")
def repair_note_gen_figures(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    """列出 assets/ 中已生成但未引用的配图（不自动插入，避免错位到文末）。"""
    from app.services.note_content import list_unreferenced_gen_assets

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    data_dir = paper_data_dir(user.id, paper_id)
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")

    raw = note_path.read_text(encoding="utf-8")
    orphans = list_unreferenced_gen_assets(data_dir, raw)
    if not orphans:
        return {"ok": True, "repaired": False, "message": "无遗漏配图"}

    names = ", ".join(orphans)
    return {
        "ok": True,
        "repaired": False,
        "figures": orphans,
        "message": f"发现 {len(orphans)} 张未引用配图（{names}），请在小节旁使用「添加配图」",
    }


@router.post("/{paper_id}/note/sections/add-figure")
async def add_figure_to_note_section(
    paper_id: int,
    body: NoteSectionAddFigureBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_section_figure import add_figure_to_section as do_add

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，请稍后再试")
    if not body.heading.strip():
        raise HTTPException(400, "请指定小节标题")

    try:
        return await do_add(
            paper_id=paper_id,
            user_id=user.id,
            heading=body.heading.strip(),
            instruction=body.instruction.strip(),
            image_model=body.image_model or "sensenova",
        )
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"配图生成失败：{e}")


@router.post("/{paper_id}/note/figures/delete")
def delete_note_figure(
    paper_id: int,
    body: NoteDeleteFigureBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_figure_delete import delete_gen_figure_from_note

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，请稍后再试")
    if not body.image_path.strip():
        raise HTTPException(400, "请指定配图路径")

    try:
        return delete_gen_figure_from_note(
            paper_id=paper_id,
            user_id=user.id,
            image_path=body.image_path.strip(),
        )
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{paper_id}/note/sections/refine")
async def refine_note_section(
    paper_id: int,
    body: NoteSectionRefineBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_section_refine import run_section_refine

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，暂不可润色")
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    if not note_path.exists():
        raise HTTPException(404, "解读笔记尚未生成")
    if not body.heading.strip():
        raise HTTPException(400, "请指定小节标题")
    if not body.instruction.strip():
        raise HTTPException(400, "请填写润色要求")

    try:
        resolve_model(session, user.id, body.model or "")
    except ValueError as e:
        raise HTTPException(400, str(e))

    async def event_generator():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def emit(ev: StreamEvent) -> None:
            await queue.put(ev)

        async def worker() -> None:
            try:
                await run_section_refine(
                    paper_id=paper_id,
                    user_id=user.id,
                    heading=body.heading.strip(),
                    instruction=body.instruction.strip(),
                    model=body.model or "",
                    enable_thinking=body.enable_thinking,
                    enable_search=body.enable_search,
                    attachments=[a.model_dump() for a in body.attachments],
                    emit=emit,
                )
            except Exception as e:
                await emit(
                    StreamEvent(type="status", data={"status": "failed", "error": str(e)})
                )
                await emit(StreamEvent(type="done", data={}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(worker())
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield ev.to_sse()
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{paper_id}/note/refine/apply")
def apply_refined_note(
    paper_id: int,
    body: NoteRefineApplyBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from app.services.note_refine import apply_refined_note as do_apply

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status == "noting":
        raise HTTPException(400, "笔记生成中，暂不可保存")

    try:
        return do_apply(
            paper_id=paper_id,
            user_id=user.id,
            content=body.content,
            model=body.model,
            conversation_id=body.conversation_id,
            assistant_message_id=body.assistant_message_id,
        )
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{paper_id}/note/export/zip")
def export_note_zip(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi.responses import Response

    from app.services.note_export import build_note_zip

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    data_dir = paper_data_dir(user.id, paper_id)
    try:
        content = build_note_zip(data_dir, paper.title)
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    filename = f"{Path(paper.title).stem or 'note'}-markdown.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{paper_id}/note/export/pdf")
def export_note_pdf(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi.responses import Response

    from app.services.note_export import build_note_pdf

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
        raise HTTPException(500, "PDF 生成结果无效")
    filename = f"{Path(paper.title).stem or 'note'}-note.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{paper_id}/note/regenerate")
async def regenerate_note(
    paper_id: int,
    body: NoteRegenerateBody,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi import HTTPException

    from app.services.note_pipeline import run_note_pipeline

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if paper.status not in ("parsed", "done", "noting", "failed"):
        raise HTTPException(400, "论文尚未解析完成，无法生成笔记")

    try:
        resolve_model(session, user.id, body.model or "")
    except ValueError as e:
        raise HTTPException(400, str(e))

    paper.status = "noting"
    paper.note_read_progress = 0
    paper.note_last_scroll_top = 0
    paper.note_last_read_at = None
    paper.note_read_epoch = (paper.note_read_epoch or 0) + 1
    session.add(paper)
    session.commit()

    reset_parse_queue(paper_id)
    background_tasks.add_task(
        run_note_pipeline,
        paper_id,
        user.id,
        True,
        body.model or "",
        body.image_model or "sensenova",
    )
    return {"status": "noting"}


@router.get("/{paper_id}/markdown")
def get_markdown(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi import HTTPException
    from fastapi.responses import PlainTextResponse

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if not paper.markdown_path:
        raise HTTPException(404, "解析结果尚未就绪")
    path = Path(paper.markdown_path)
    if not path.exists():
        raise HTTPException(404, "Markdown 不存在")
    return PlainTextResponse(path.read_text(encoding="utf-8"), media_type="text/plain")


@router.get("/{paper_id}/markdown/translation")
def get_markdown_translation(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    from fastapi.responses import PlainTextResponse

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    try:
        content = load_translation(user.id, paper_id)
    except FileNotFoundError:
        raise HTTPException(404, "中文翻译不存在")
    return PlainTextResponse(content, media_type="text/plain")


@router.post("/{paper_id}/markdown/translate")
async def translate_markdown_api(
    paper_id: int,
    body: MarkdownTranslateBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    if not paper.markdown_path:
        raise HTTPException(400, "Markdown 尚未就绪")
    md_path = Path(paper.markdown_path)
    if not md_path.exists():
        raise HTTPException(404, "Markdown 不存在")

    source = md_path.read_text(encoding="utf-8")
    if not source.strip():
        raise HTTPException(400, "Markdown 内容为空")

    user_id = user.id
    model_key = body.model

    async def event_generator():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def emit(ev: StreamEvent) -> None:
            await queue.put(ev)

        async def worker() -> None:
            from app.db.session import get_engine

            try:
                with Session(get_engine()) as worker_session:
                    await run_translate_markdown_stream(
                        session=worker_session,
                        user_id=user_id,
                        paper_id=paper_id,
                        source_markdown=source,
                        model_key=model_key,
                        emit=emit,
                    )
                await emit(StreamEvent(type="done", data={}))
            except ValueError as e:
                await emit(
                    StreamEvent(type="status", data={"status": "failed", "error": str(e)})
                )
                await emit(StreamEvent(type="done", data={}))
            except RuntimeError as e:
                await emit(
                    StreamEvent(type="status", data={"status": "failed", "error": str(e)})
                )
                await emit(StreamEvent(type="done", data={}))
            except Exception as e:
                await emit(
                    StreamEvent(type="status", data={"status": "failed", "error": str(e)})
                )
                await emit(StreamEvent(type="done", data={}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(worker())
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield ev.to_sse()
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{paper_id}/files/{file_path:path}")
def get_mineru_file(
    paper_id: int,
    file_path: str,
    session: Annotated[Session, Depends(get_session)],
    token: str | None = None,
    creds: Annotated[
        HTTPAuthorizationCredentials | None, Depends(security)
    ] = None,
):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    raw_token = creds.credentials if creds else token
    if not raw_token:
        raise HTTPException(401, "请先登录")
    payload = decode_token(raw_token)
    user_id = int(payload["sub"])

    from app.services.note_sections import resolve_paper_file_path

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user_id:
        raise HTTPException(404, "论文不存在")
    data_base = paper_data_dir(user_id, paper_id)
    target = resolve_paper_file_path(data_base, file_path)
    if target is None:
        raise HTTPException(404, "文件不存在")
    headers = None
    rel = str(target.relative_to(data_base.resolve())).replace("\\", "/")
    if rel.startswith("images/gen/") or rel.startswith("assets/gen_"):
        headers = {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        }
    return FileResponse(target, headers=headers)
