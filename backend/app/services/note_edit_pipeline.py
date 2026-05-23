"""AI 编辑笔记：多轮对话修改解读笔记（独立会话，不参与问答融合）"""

from __future__ import annotations

import json
import re

from sqlmodel import Session, select

from app.db.models import Conversation, Message, utc_now
from app.db.session import get_engine
from app.prompts.note_edit import NOTE_EDIT_SYSTEM, NOTE_EDIT_WELCOME
from app.schemas.events import StreamEvent
from app.services.chat_pipeline import build_chat_messages
from app.services.ark_client import GEN_FIGURE_TOOL
from app.services.chat_tools import make_gen_figure_tool_handler
from app.services.llm import run_with_tool_loop
from app.services.model_registry import resolve_model
from app.services.mineru import paper_data_dir


def _load_note(data_dir) -> str:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")
    text = note_path.read_text(encoding="utf-8")
    return text[:48000] if len(text) > 48000 else text


def create_note_edit_conversation(session: Session, paper_id: int) -> Conversation:
    conv = Conversation(paper_id=paper_id, title="AI 编辑笔记", kind="note_edit")
    session.add(conv)
    session.commit()
    session.refresh(conv)

    welcome = Message(
        conversation_id=conv.id,
        role="assistant",
        content=NOTE_EDIT_WELCOME,
        model="system",
    )
    session.add(welcome)
    session.commit()
    return conv


def list_note_edit_conversations(session: Session, paper_id: int) -> list[Conversation]:
    return session.exec(
        select(Conversation)
        .where(Conversation.paper_id == paper_id, Conversation.kind == "note_edit")
        .order_by(Conversation.updated_at.desc())
    ).all()


def get_active_note_edit_conversation(
    session: Session, paper_id: int
) -> Conversation | None:
    return session.exec(
        select(Conversation)
        .where(Conversation.paper_id == paper_id, Conversation.kind == "note_edit")
        .order_by(Conversation.updated_at.desc())
    ).first()


async def _noop_tool(_name: str, _args: dict) -> str:
    return json.dumps({"message": "ok"}, ensure_ascii=False)


async def run_note_edit_turn(
    *,
    paper_id: int,
    user_id: int,
    conversation_id: int,
    user_text: str,
    model: str,
    enable_thinking: bool,
    emit,
) -> None:
    data_dir = paper_data_dir(user_id, paper_id)
    note_content = _load_note(data_dir)
    system_prompt = NOTE_EDIT_SYSTEM.format(note_content=note_content)
    engine = get_engine()

    with Session(engine) as session:
        conv = session.get(Conversation, conversation_id)
        if not conv or conv.paper_id != paper_id or conv.kind != "note_edit":
            raise ValueError("编辑会话不存在")
        history = session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
        ).all()

        user_msg = Message(
            conversation_id=conversation_id,
            role="user",
            content=user_text,
        )
        session.add(user_msg)
        conv.updated_at = utc_now()
        if conv.title in ("AI 编辑笔记", "新编辑") and user_text.strip():
            conv.title = user_text.strip()[:28] + (
                "…" if len(user_text.strip()) > 28 else ""
            )
        session.add(conv)
        session.commit()
        session.refresh(user_msg)

        input_messages = build_chat_messages(
            system_prompt=system_prompt,
            history=history,
            user_text=user_text,
            attachments=[],
            data_dir=data_dir,
            enable_thinking=enable_thinking,
        )

    await emit(StreamEvent(type="status", data={"status": "answering"}))

    thinking_parts: list[str] = []
    content_parts: list[str] = []
    tool_trace: list[dict] = []
    had_tool_call = False
    usage: dict[str, int] = {}

    async def on_emit(ev: StreamEvent) -> None:
        nonlocal had_tool_call
        if ev.type == "thinking":
            delta = ev.data.get("delta", "")
            if delta:
                thinking_parts.append(delta)
        elif ev.type == "content":
            delta = ev.data.get("delta", "")
            if delta:
                content_parts.append(delta)
        elif ev.type in ("tool_start", "tool_delta", "tool_end", "references"):
            had_tool_call = True
            tool_trace.append({"type": ev.type, **ev.data})
        elif ev.type == "usage":
            usage.update(ev.data)
        await emit(ev)

    try:
        with Session(engine) as session:
            endpoint = resolve_model(session, user_id, model or "")
        tool_handler = make_gen_figure_tool_handler(paper_id, user_id)
        await run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=[GEN_FIGURE_TOOL],
            tool_handler=tool_handler,
            emit=on_emit,
            emit_content=True,
            enable_thinking=enable_thinking,
        )
    except Exception as e:
        await emit(
            StreamEvent(type="status", data={"status": "failed", "error": str(e)})
        )
        await emit(StreamEvent(type="done", data={}))
        return

    answer = "".join(content_parts)
    reasoning = "".join(thinking_parts)

    with Session(engine) as session:
        assistant = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=answer,
            reasoning_content=reasoning,
            had_tool_call=had_tool_call,
            tool_trace_json=json.dumps(tool_trace[-80:], ensure_ascii=False),
            model=endpoint.key,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
        )
        session.add(assistant)
        conv = session.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = utc_now()
            session.add(conv)
        session.commit()
        session.refresh(assistant)

    await emit(
        StreamEvent(
            type="status",
            data={
                "status": "answered",
                "assistant_message_id": assistant.id,
            },
        )
    )
    await emit(StreamEvent(type="done", data={}))


def extract_note_markdown_from_assistant(content: str) -> str | None:
    """从助手回复中解析 ```markdown 代码块内的完整笔记。"""
    text = (content or "").strip()
    if not text:
        return None
    match = re.search(r"```(?:markdown|md)?\s*\n([\s\S]*?)```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None
