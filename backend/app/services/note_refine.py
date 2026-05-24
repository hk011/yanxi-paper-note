"""问答融合回笔记流水线"""

from __future__ import annotations

import json
from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Conversation, Message, Note
from app.db.session import get_engine
from app.prompts.note_refine import (
    INTENT_LABELS,
    NOTE_REFINE_CONVERSATION_USER,
    NOTE_REFINE_SYSTEM,
    NOTE_REFINE_USER,
)
from app.schemas.events import StreamEvent
from app.services.llm import run_with_tool_loop
from app.services.mineru import paper_data_dir
from app.services.model_registry import resolve_model, resolve_note_model_on_save


def _load_note(data_dir: Path) -> str:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")
    return note_path.read_text(encoding="utf-8")


def _format_turn(user_msg: Message, assistant_msg: Message) -> str:
    parts = [f"用户：{user_msg.content.strip()}"]
    parts.append(f"助手：{assistant_msg.content.strip()}")
    return "\n\n".join(parts)


def _format_dialogue(messages: list[Message]) -> str:
    lines: list[str] = []
    for msg in messages:
        if not msg.content.strip():
            continue
        label = "用户" if msg.role == "user" else "助手"
        text = msg.content.strip()
        if len(text) > 4000:
            text = text[:4000] + "…"
        lines.append(f"{label}：{text}")
    return "\n\n".join(lines)


def _build_refine_prompt(
    *,
    note_content: str,
    intent: str,
    scope: str,
    messages: list[Message],
    assistant_message_id: int | None,
) -> str:
    intent_label = INTENT_LABELS.get(intent, INTENT_LABELS["refine"])
    note_trimmed = note_content[:48000] if len(note_content) > 48000 else note_content

    if scope == "turn":
        assistant_msg = next(
            (m for m in messages if m.id == assistant_message_id and m.role == "assistant"),
            None,
        )
        if not assistant_msg:
            raise ValueError("未找到指定回答")
        idx = messages.index(assistant_msg)
        user_msg = None
        for i in range(idx - 1, -1, -1):
            if messages[i].role == "user":
                user_msg = messages[i]
                break
        if not user_msg:
            raise ValueError("未找到对应的用户问题")
        qa_snippet = _format_turn(user_msg, assistant_msg)
        return NOTE_REFINE_USER.format(
            intent_label=intent_label,
            note_content=note_trimmed,
            qa_snippet=qa_snippet,
        )

    dialogue = _format_dialogue(messages)
    if not dialogue.strip():
        raise ValueError("当前会话没有可融合的对话内容")
    return NOTE_REFINE_CONVERSATION_USER.format(
        intent_label=intent_label,
        note_content=note_trimmed,
        dialogue=dialogue,
    )


def apply_refined_note(
    *,
    paper_id: int,
    user_id: int,
    content: str,
    model: str,
    conversation_id: int | None = None,
    assistant_message_id: int | None = None,
    auto_insert_orphans: bool = False,
) -> dict:
    """写入 note.md 并更新当前版本记录（不递增版本号、不备份历史文件）。"""
    if not content.strip():
        raise ValueError("笔记内容不能为空")

    data_dir = paper_data_dir(user_id, paper_id)
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")

    engine = get_engine()
    with Session(engine) as session:
        from app.services.note_content import prepare_note_content_for_save

        prepared = prepare_note_content_for_save(
            content=content,
            paper_id=paper_id,
            data_dir=data_dir,
            session=session,
            conversation_id=conversation_id,
            assistant_message_id=assistant_message_id,
            auto_insert_orphans=auto_insert_orphans,
        )
        current_note = session.exec(
            select(Note).where(Note.paper_id == paper_id).order_by(Note.version.desc())
        ).first()

        note_path.write_text(prepared, encoding="utf-8")

        existing_model = current_note.model if current_note else ""
        stored_model = resolve_note_model_on_save(
            model,
            existing_model,
            session=session,
            paper_id=paper_id,
        )

        if current_note:
            current_note.md_path = str(note_path)
            if stored_model:
                current_note.model = stored_model
            session.add(current_note)
            note_version = current_note.version
            session.commit()
        else:
            session.add(
                Note(
                    paper_id=paper_id,
                    version=1,
                    md_path=str(note_path),
                    model=stored_model or model or "",
                )
            )
            session.commit()
            note_version = 1

    return {
        "ok": True,
        "note_version": note_version,
        "previous_version": note_version,
    }


async def run_note_refine(
    *,
    paper_id: int,
    user_id: int,
    conversation_id: int,
    scope: str,
    intent: str,
    assistant_message_id: int | None,
    model: str,
    emit,
) -> None:
    data_dir = paper_data_dir(user_id, paper_id)
    note_content = _load_note(data_dir)

    engine = get_engine()
    with Session(engine) as session:
        conv = session.get(Conversation, conversation_id)
        if not conv or conv.paper_id != paper_id or conv.kind != "qa":
            raise ValueError("会话不存在")
        messages = session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
        ).all()
        endpoint = resolve_model(session, user_id, model or "")

    user_prompt = _build_refine_prompt(
        note_content=note_content,
        intent=intent,
        scope=scope,
        messages=list(messages),
        assistant_message_id=assistant_message_id,
    )

    await emit(StreamEvent(type="status", data={"status": "refining"}))

    input_messages = [
        {"role": "system", "content": NOTE_REFINE_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    content_parts: list[str] = []

    async def on_content(delta: str) -> None:
        content_parts.append(delta)
        await emit(StreamEvent(type="content", data={"delta": delta}))

    async def on_emit(ev: StreamEvent) -> None:
        if ev.type == "usage":
            await emit(ev)

    try:
        refined = await run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=[],
            tool_handler=_noop_refine_tool,
            on_content=on_content,
            emit=on_emit,
            emit_content=True,
            enable_thinking=False,
        )
    except Exception as e:
        await emit(
            StreamEvent(type="status", data={"status": "failed", "error": str(e)})
        )
        await emit(StreamEvent(type="done", data={}))
        return

    refined = (refined or "".join(content_parts)).strip()
    if not refined:
        await emit(
            StreamEvent(
                type="status",
                data={"status": "failed", "error": "模型未返回有效笔记内容"},
            )
        )
        await emit(StreamEvent(type="done", data={}))
        return

    await emit(
        StreamEvent(
            type="status",
            data={
                "status": "refined",
                "scope": scope,
                "intent": intent,
            },
        )
    )
    await emit(StreamEvent(type="done", data={"content_length": len(refined)}))


async def _noop_refine_tool(_name: str, _args: dict) -> str:
    return json.dumps({"message": "ok"}, ensure_ascii=False)
