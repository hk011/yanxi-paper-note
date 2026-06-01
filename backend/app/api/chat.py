import asyncio
import json
import uuid
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.core.auth import get_current_user
from app.db.models import Conversation, Message, Paper, User
from app.db.session import get_engine, get_session
from app.schemas.chat import (
    ChatConfigOut,
    ChatConversationListOut,
    ChatConversationOut,
    ChatConversationSummary,
    ChatMessageOut,
    ChatSendRequest,
    ChatSuggestionsOut,
    ChatSuggestionItem,
    ModelOptionOut,
)
from app.schemas.events import StreamEvent
from app.services.chat_pipeline import (
    _conversation_preview,
    build_suggestions,
    create_conversation,
    get_or_create_conversation,
    list_conversations,
    run_chat_turn,
)
from app.services.model_registry import default_model_key, list_model_options
from app.services.mineru import paper_data_dir

router = APIRouter(prefix="/api/papers/{paper_id}/chat", tags=["chat"])


def _ensure_paper(
    paper_id: int, user: User, session: Session
) -> Paper:
    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    return paper


def _message_out(msg: Message) -> ChatMessageOut:
    return ChatMessageOut(
        id=msg.id,
        role=msg.role,
        content=msg.content,
        reasoning_content=msg.reasoning_content,
        had_tool_call=msg.had_tool_call,
        references=json.loads(msg.references_json or "[]"),
        tool_trace=json.loads(msg.tool_trace_json or "[]"),
        attachments=json.loads(msg.attachments_json or "[]"),
        model=msg.model,
        prompt_tokens=msg.prompt_tokens,
        completion_tokens=msg.completion_tokens,
        created_at=msg.created_at,
    )


def _conversation_out(session: Session, conv: Conversation) -> ChatConversationOut:
    messages = session.exec(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.asc())
    ).all()
    return ChatConversationOut(
        id=conv.id,
        paper_id=conv.paper_id,
        title=conv.title,
        messages=[_message_out(m) for m in messages],
    )


def _resolve_conversation(
    session: Session, paper_id: int, conversation_id: int | None
) -> Conversation:
    if conversation_id is not None:
        conv = session.get(Conversation, conversation_id)
        if not conv or conv.paper_id != paper_id or conv.kind != "qa":
            raise HTTPException(404, "会话不存在")
        return conv
    return get_or_create_conversation(session, paper_id)


@router.get("/config", response_model=ChatConfigOut)
def chat_config(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    options = list_model_options(session, user.id)
    from app.services.web_search import web_search_configured
    from app.services.tools.image_gen import list_image_model_options
    from app.schemas.model import ImageModelOptionOut

    return ChatConfigOut(
        models=[
            ModelOptionOut(id=opt.id, label=opt.label, source=opt.source)
            for opt in options
        ],
        default_model=default_model_key(session, user.id),
        mcp_search_available=web_search_configured(),
        image_models=[
            ImageModelOptionOut(**item) for item in list_image_model_options()
        ],
    )


@router.get("/suggestions", response_model=ChatSuggestionsOut)
def chat_suggestions(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    data_dir = paper_data_dir(user.id, paper_id)
    note_path = data_dir / "note.md"
    note_text = note_path.read_text(encoding="utf-8") if note_path.exists() else ""
    items = [
        ChatSuggestionItem(**item) for item in build_suggestions(note_text)
    ]
    return ChatSuggestionsOut(items=items)


@router.get("/conversations", response_model=ChatConversationListOut)
def list_chat_conversations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    convs = list_conversations(session, paper_id)
    items: list[ChatConversationSummary] = []
    for conv in convs:
        messages = session.exec(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.asc())
        ).all()
        updated = conv.updated_at or conv.created_at
        items.append(
            ChatConversationSummary(
                id=conv.id,
                paper_id=conv.paper_id,
                title=conv.title,
                message_count=len(messages),
                preview=_conversation_preview(list(messages)),
                created_at=conv.created_at,
                updated_at=updated,
            )
        )
    active_id = items[0].id if items else None
    return ChatConversationListOut(items=items, active_id=active_id)


@router.post("/conversations", response_model=ChatConversationOut, status_code=201)
def create_chat_conversation(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    conv = create_conversation(session, paper_id)
    return ChatConversationOut(
        id=conv.id,
        paper_id=conv.paper_id,
        title=conv.title,
        messages=[],
    )


@router.get("/conversations/{conversation_id}", response_model=ChatConversationOut)
def get_chat_conversation(
    paper_id: int,
    conversation_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    conv = session.get(Conversation, conversation_id)
    if not conv or conv.paper_id != paper_id or conv.kind != "qa":
        raise HTTPException(404, "会话不存在")
    return _conversation_out(session, conv)


@router.post("/conversation/reset", status_code=204)
def reset_conversation(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    """兼容旧接口：创建新会话而非清空消息。"""
    _ensure_paper(paper_id, user, session)
    create_conversation(session, paper_id)


@router.get("/conversation", response_model=ChatConversationOut)
def get_conversation(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    conversation_id: int | None = Query(default=None),
):
    _ensure_paper(paper_id, user, session)
    conv = _resolve_conversation(session, paper_id, conversation_id)
    return _conversation_out(session, conv)


@router.post("/upload")
async def upload_chat_image(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    file: UploadFile = File(...),
):
    _ensure_paper(paper_id, user, session)
    if not file.filename:
        raise HTTPException(400, "无效文件")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        raise HTTPException(400, "仅支持 JPG/PNG/GIF/WebP 图片")

    data_dir = paper_data_dir(user.id, paper_id)
    upload_dir = data_dir / "chat_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    dest = upload_dir / name
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(400, "图片不能超过 8MB")
    async with aiofiles.open(dest, "wb") as out:
        await out.write(content)

    rel = f"chat_uploads/{name}"
    return {
        "path": rel,
        "name": file.filename,
        "url": f"/api/papers/{paper_id}/files/{rel}",
    }


@router.post("/messages")
async def send_chat_message(
    paper_id: int,
    body: ChatSendRequest,
    user: Annotated[User, Depends(get_current_user)],
):
    with Session(get_engine()) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user.id:
            raise HTTPException(404, "论文不存在")
        if paper.status not in ("done", "noting", "parsed"):
            raise HTTPException(400, "论文尚未就绪，暂无法问答")
        conv = _resolve_conversation(session, paper_id, body.conversation_id)
        conversation_id = conv.id
        model = body.model or default_model_key(session, user.id)
    attachments = [a.model_dump() for a in body.attachments]

    async def event_generator():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def emit(ev: StreamEvent) -> None:
            await queue.put(ev)

        async def worker() -> None:
            try:
                await run_chat_turn(
                    paper_id=paper_id,
                    user_id=user.id,
                    conversation_id=conversation_id,
                    user_text=body.content.strip(),
                    model=model,
                    enable_thinking=body.enable_thinking,
                    enable_search=body.enable_search,
                    enable_figure_gen=body.enable_figure_gen,
                    image_model=body.image_model or "ark",
                    attachments=attachments,
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
