import asyncio

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.core.auth import get_current_user
from app.db.models import Conversation, Message, Paper, User
from app.db.session import get_engine, get_session
from app.schemas.chat import (
    ChatConversationListOut,
    ChatConversationOut,
    ChatConversationSummary,
    ChatSendRequest,
)
from app.schemas.events import StreamEvent
from app.services.chat_pipeline import _conversation_preview
from app.services.note_edit_pipeline import (
    create_note_edit_conversation,
    get_active_note_edit_conversation,
    list_note_edit_conversations,
    run_note_edit_turn,
)
from app.api.chat import _conversation_out, _ensure_paper

router = APIRouter(prefix="/api/papers/{paper_id}/note-edit", tags=["note-edit"])


@router.post("/conversations", response_model=ChatConversationOut, status_code=201)
def start_note_edit_conversation(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    data_dir_note = _ensure_note_exists(paper_id, user, session)
    if not data_dir_note:
        raise HTTPException(400, "解读笔记尚未生成")
    conv = create_note_edit_conversation(session, paper_id)
    return _conversation_out(session, conv)


def _ensure_note_exists(paper_id: int, user: User, session: Session) -> bool:
    from app.services.mineru import paper_data_dir

    paper = session.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(404, "论文不存在")
    note_path = paper_data_dir(user.id, paper_id) / "note.md"
    return note_path.exists()


@router.get("/conversations", response_model=ChatConversationListOut)
def list_note_edit_sessions(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    convs = list_note_edit_conversations(session, paper_id)
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


@router.get("/conversations/active", response_model=ChatConversationOut | None)
def get_active_note_edit(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    conv = get_active_note_edit_conversation(session, paper_id)
    if not conv:
        return None
    return _conversation_out(session, conv)


@router.get("/conversations/{conversation_id}", response_model=ChatConversationOut)
def get_note_edit_conversation(
    paper_id: int,
    conversation_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    _ensure_paper(paper_id, user, session)
    conv = session.get(Conversation, conversation_id)
    if not conv or conv.paper_id != paper_id or conv.kind != "note_edit":
        raise HTTPException(404, "编辑会话不存在")
    return _conversation_out(session, conv)


@router.post("/messages")
async def send_note_edit_message(
    paper_id: int,
    body: ChatSendRequest,
    user: Annotated[User, Depends(get_current_user)],
):
    with Session(get_engine()) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user.id:
            raise HTTPException(404, "论文不存在")
        if not body.conversation_id:
            raise HTTPException(400, "缺少 conversation_id")
        conv = session.get(Conversation, body.conversation_id)
        if not conv or conv.paper_id != paper_id or conv.kind != "note_edit":
            raise HTTPException(404, "编辑会话不存在")
        conversation_id = conv.id
        from app.services.model_registry import default_model_key

        model = body.model or default_model_key(session, user.id)

    async def event_generator():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def emit(ev: StreamEvent) -> None:
            await queue.put(ev)

        async def worker() -> None:
            try:
                await run_note_edit_turn(
                    paper_id=paper_id,
                    user_id=user.id,
                    conversation_id=conversation_id,
                    user_text=body.content.strip(),
                    model=model,
                    enable_thinking=body.enable_thinking,
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
