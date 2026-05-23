import asyncio
import shutil
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import decode_token, get_current_user, security
from app.core.config import get_settings
from app.db.models import Asset, Conversation, Note, Paper, User, utc_now
from app.db.session import get_session
from app.schemas.events import StreamEvent
from app.schemas.paper import NoteRefineApplyBody, NoteRefineRequest, NoteUpdateBody, PaperDetail, PaperSummary
from app.services.mineru import count_pdf_pages, paper_data_dir
from app.services.parse_time import parse_elapsed_seconds
from app.services.parse_worker import (
    get_parse_queue,
    remove_parse_queue,
    reset_parse_queue,
    run_parse_pipeline,
)

router = APIRouter(prefix="/api/papers", tags=["papers"])


def _to_summary(p: Paper) -> PaperSummary:
    return PaperSummary(
        id=p.id,
        title=p.title,
        status=p.status,
        total_pages=p.total_pages,
        parsed_pages=p.parsed_pages,
        parse_elapsed_seconds=parse_elapsed_seconds(p),
        error_message=p.error_message,
        created_at=p.created_at,
    )


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
):
    papers = session.exec(
        select(Paper).where(Paper.user_id == user.id).order_by(Paper.created_at.desc())
    ).all()
    for paper in papers:
        _ensure_total_pages(session, paper)
    return [_to_summary(p) for p in papers]


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
    return PaperDetail(
        **_to_summary(paper).model_dump(),
        pdf_url=f"/api/papers/{paper_id}/pdf",
        markdown_url=md_url,
        has_markdown=bool(paper.markdown_path and Path(paper.markdown_path).exists()),
        note_url=f"/api/papers/{paper_id}/note" if has_note else None,
        has_note=has_note,
        note_version=note.version if note else 0,
    )


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
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        from fastapi import HTTPException

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

    get_parse_queue(paper.id)
    background_tasks.add_task(run_parse_pipeline, paper.id, user.id)
    return _to_summary(paper)


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
    return PlainTextResponse(note_path.read_text(encoding="utf-8"), media_type="text/plain")


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

    settings = get_settings()
    model = body.model or settings.model_list[0]

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
                    model=model,
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
    try:
        content = build_note_pdf(data_dir, paper.title)
    except FileNotFoundError:
        raise HTTPException(404, "解读笔记尚未生成")
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    filename = f"{Path(paper.title).stem or 'note'}-note.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{paper_id}/note/regenerate")
async def regenerate_note(
    paper_id: int,
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

    paper.status = "noting"
    session.add(paper)
    session.commit()

    reset_parse_queue(paper_id)
    background_tasks.add_task(run_note_pipeline, paper_id, user.id, True)
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

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user_id:
        raise HTTPException(404, "论文不存在")
    data_base = paper_data_dir(user_id, paper_id)
    base = data_base / "mineru"
    if file_path.startswith("assets/") or file_path.startswith("chat_uploads/"):
        base = data_base
    target = (base / file_path).resolve()
    if not str(target).startswith(str(data_base.resolve())):
        raise HTTPException(403, "非法路径")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(target)
