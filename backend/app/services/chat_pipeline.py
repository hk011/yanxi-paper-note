"""论文智能问答流水线"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

from sqlmodel import Session, select

from app.core.config import get_settings
from app.db.models import Conversation, Message, Paper, utc_now
from app.db.session import get_engine
from app.prompts.chat import (
    CHAT_FIGURE_CAPABILITY_OFF,
    CHAT_FIGURE_CAPABILITY_ON,
    CHAT_SEARCH_CAPABILITY_MCP,
    CHAT_SYSTEM,
    FOLLOWUP_SUGGESTIONS_USER,
)
from app.services.web_search import web_search_configured
from app.schemas.events import StreamEvent
from app.services.ark_client import GEN_FIGURE_TOOL
from app.services.chat_tools import make_gen_figure_tool_handler
from app.services.search_tools import build_search_tools, wrap_tool_handler_with_web_search
from app.services.content_builder import build_paper_skeleton, load_content_list
from app.services.llm import complete_text, run_with_tool_loop
from app.services.model_registry import default_model_key, list_model_options, resolve_model
from app.services.mineru import paper_data_dir


async def _noop_chat_tool(_name: str, _args: dict) -> str:
    return json.dumps({"message": "当前问答不支持该工具"}, ensure_ascii=False)


def _load_note(data_dir: Path) -> str:
    note_path = data_dir / "note.md"
    if not note_path.exists():
        return "（解读笔记尚未生成）"
    text = note_path.read_text(encoding="utf-8")
    return text[:48000] if len(text) > 48000 else text


def _load_skeleton(data_dir: Path) -> str:
    parsed_md = ""
    md_p = data_dir / "parsed.md"
    if md_p.exists():
        parsed_md = md_p.read_text(encoding="utf-8")
    content_list = load_content_list(data_dir)
    skeleton = build_paper_skeleton(content_list, parsed_md)
    return skeleton[:12000]


def get_or_create_conversation(session: Session, paper_id: int) -> Conversation:
    conv = session.exec(
        select(Conversation)
        .where(Conversation.paper_id == paper_id, Conversation.kind == "qa")
        .order_by(Conversation.updated_at.desc())
    ).first()
    if conv:
        return conv
    conv = Conversation(paper_id=paper_id, title="新对话")
    session.add(conv)
    session.commit()
    session.refresh(conv)
    return conv


def create_conversation(session: Session, paper_id: int, title: str = "新对话") -> Conversation:
    conv = Conversation(paper_id=paper_id, title=title, kind="qa")
    session.add(conv)
    session.commit()
    session.refresh(conv)
    return conv


def list_conversations(session: Session, paper_id: int) -> list[Conversation]:
    return session.exec(
        select(Conversation)
        .where(Conversation.paper_id == paper_id, Conversation.kind == "qa")
        .order_by(Conversation.updated_at.desc())
    ).all()


def _conversation_preview(messages: list[Message]) -> str:
    for msg in reversed(messages):
        if msg.role == "user" and msg.content.strip():
            text = msg.content.strip().replace("\n", " ")
            return text[:60] + ("…" if len(text) > 60 else "")
    return ""


def _pick_suggestion_model(models: list[str], fallback: str) -> str:
    for m in models:
        low = m.lower()
        if "lite" in low or "mini" in low:
            return m
    return fallback


def _format_dialogue_for_suggestions(
    history: list[Message],
    user_text: str,
    answer: str,
    max_turns: int = 8,
) -> str:
    lines: list[str] = []
    for msg in history[-max_turns:]:
        label = "用户" if msg.role == "user" else "助手"
        text = (msg.content or "").strip().replace("\n", " ")
        if not text:
            continue
        if len(text) > 500:
            text = text[:500] + "…"
        lines.append(f"{label}：{text}")
    lines.append(f"用户：{user_text.strip()}")
    ans = answer.strip().replace("\n", " ")
    if len(ans) > 800:
        ans = ans[:800] + "…"
    lines.append(f"助手：{ans}")
    return "\n\n".join(lines)


def _parse_suggestion_lines(raw: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        line = re.sub(r"^[\s\d\.\)\-*、]+", "", line.strip())
        line = line.strip("「」\"'")
        if len(line) < 6 or line in seen:
            continue
        seen.add(line)
        items.append({"key": f"llm-{len(items)}", "label": line})
        if len(items) >= 3:
            break
    return items


async def generate_followup_suggestions(
    *,
    user_id: int,
    model_key: str,
    history: list[Message],
    user_text: str,
    answer: str,
) -> list[dict[str, str]]:
    """调用模型根据对话记录生成 1–3 条追问推荐。"""
    dialogue = _format_dialogue_for_suggestions(history, user_text, answer)
    prompt = FOLLOWUP_SUGGESTIONS_USER.format(dialogue=dialogue)
    try:
        with Session(get_engine()) as session:
            endpoint = resolve_model(session, user_id, model_key)
        raw = await complete_text(
            endpoint=endpoint,
            input_messages=[{"role": "user", "content": prompt}],
            enable_thinking=False,
            timeout=45.0,
        )
        return _parse_suggestion_lines(raw)
    except Exception:
        return []


def build_suggestions(_note_text: str) -> list[dict[str, str]]:
    """空对话时的初始推荐，固定 3 条。"""
    templates = [
        "这篇论文的核心贡献是什么？",
        "论文的主要实验结果说明了什么？",
        "有哪些局限性和未来研究方向？",
    ]
    return [{"key": f"tpl-{i}", "label": t} for i, t in enumerate(templates)]


def _resolve_attachment_path(data_dir: Path, rel_path: str) -> Path | None:
    clean = rel_path.replace("\\", "/").lstrip("/")
    if clean.startswith(".."):
        return None
    target = (data_dir / clean).resolve()
    if not str(target).startswith(str(data_dir.resolve())):
        return None
    if not target.exists() or not target.is_file():
        return None
    return target


def _image_to_input_part(path: Path) -> dict:
    suffix = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(suffix, "image/jpeg")
    raw = path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return {
        "type": "input_image",
        "image_url": f"data:{mime};base64,{b64}",
    }


def _build_user_content(
    text: str,
    attachments: list[dict],
    data_dir: Path,
) -> str | list[dict]:
    parts: list[dict] = [{"type": "input_text", "text": text}]
    for att in attachments:
        rel = att.get("path") or att.get("url") or ""
        resolved = _resolve_attachment_path(data_dir, str(rel))
        if resolved:
            parts.append(_image_to_input_part(resolved))
    if len(parts) == 1:
        return text
    return parts


def _message_to_api(msg: Message, enable_thinking: bool) -> dict:
    if msg.role == "user":
        attachments = json.loads(msg.attachments_json or "[]")
        # 历史用户消息仅回传文本，避免重复传图占上下文
        if attachments:
            names = ", ".join(
                a.get("name") or a.get("path", "") for a in attachments if isinstance(a, dict)
            )
            content = f"{msg.content}\n\n（用户曾上传图片：{names}）"
        else:
            content = msg.content
        return {"role": "user", "content": content}

    content = msg.content
    if msg.had_tool_call and msg.reasoning_content and enable_thinking:
        content = (
            f"<thinking>\n{msg.reasoning_content[:8000]}\n</thinking>\n\n{content}"
        )
    return {"role": "assistant", "content": content}


def build_chat_messages(
    *,
    system_prompt: str,
    history: list[Message],
    user_text: str,
    attachments: list[dict],
    data_dir: Path,
    enable_thinking: bool,
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append(_message_to_api(msg, enable_thinking))
    messages.append(
        {
            "role": "user",
            "content": _build_user_content(user_text, attachments, data_dir),
        }
    )
    return messages


async def run_chat_turn(
    *,
    paper_id: int,
    user_id: int,
    conversation_id: int,
    user_text: str,
    model: str,
    enable_thinking: bool,
    enable_search: bool,
    enable_figure_gen: bool,
    image_model: str = "ark",
    attachments: list[dict],
    emit,
) -> None:
    data_dir = paper_data_dir(user_id, paper_id)
    engine = get_engine()

    note_text = _load_note(data_dir)
    skeleton = _load_skeleton(data_dir)
    if enable_search:
        search_capability = (
            CHAT_SEARCH_CAPABILITY_MCP
            if web_search_configured()
            else "- 用户已开启联网搜索（内置模型将自动检索）"
        )
    else:
        search_capability = "- 用户未开启联网搜索，请勿调用 web_search"

    system_prompt = CHAT_SYSTEM.format(
        note_content=note_text,
        paper_skeleton=skeleton,
        thinking_label="已开启" if enable_thinking else "已关闭",
        search_label="已开启" if enable_search else "已关闭",
        figure_label="已开启" if enable_figure_gen else "已关闭",
        search_capability=search_capability,
        figure_capability=(
            CHAT_FIGURE_CAPABILITY_ON
            if enable_figure_gen
            else CHAT_FIGURE_CAPABILITY_OFF
        ),
    )

    history_for_suggestions: list[Message] = []

    with Session(engine) as session:
        conv = session.get(Conversation, conversation_id)
        if not conv or conv.paper_id != paper_id or conv.kind != "qa":
            raise ValueError("会话不存在")
        history = session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
        ).all()
        history_for_suggestions = list(history)

        user_msg = Message(
            conversation_id=conversation_id,
            role="user",
            content=user_text,
            attachments_json=json.dumps(attachments, ensure_ascii=False),
        )
        session.add(user_msg)
        conv.updated_at = utc_now()
        if conv.title in ("论文问答", "新对话") and user_text.strip():
            conv.title = user_text.strip()[:30] + (
                "…" if len(user_text.strip()) > 30 else ""
            )
        session.add(conv)
        session.commit()
        session.refresh(user_msg)
        user_message_id = user_msg.id
        endpoint = resolve_model(session, user_id, model or "")

        tools: list[dict] = list(
            build_search_tools(endpoint, enable_search=enable_search)
        )
        if enable_figure_gen:
            tools.append(GEN_FIGURE_TOOL)
        input_messages = build_chat_messages(
            system_prompt=system_prompt,
            history=history,
            user_text=user_text,
            attachments=attachments,
            data_dir=data_dir,
            enable_thinking=enable_thinking,
        )

    await emit(StreamEvent(type="status", data={"status": "answering"}))

    thinking_parts: list[str] = []
    content_parts: list[str] = []
    tool_trace: list[dict] = []
    references: list[dict] = []
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
            if ev.type == "references":
                items = ev.data.get("items") or []
                if isinstance(items, list):
                    references.extend(items)
        elif ev.type == "usage":
            usage.update(ev.data)
        await emit(ev)

    try:
        base_handler = (
            make_gen_figure_tool_handler(paper_id, user_id, image_model=image_model)
            if enable_figure_gen
            else _noop_chat_tool
        )
        tool_handler = wrap_tool_handler_with_web_search(
            base_handler, emit=on_emit, endpoint=endpoint
        )
        await run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=tools,
            tool_handler=tool_handler,
            emit=on_emit,
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
            references_json=json.dumps(references[:20], ensure_ascii=False),
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

        with Session(engine) as session:
            options = list_model_options(session, user_id)
            suggestion_key = _pick_suggestion_model(
                [opt.id for opt in options],
                endpoint.key,
            )
        followups = await generate_followup_suggestions(
            user_id=user_id,
            model_key=suggestion_key,
            history=history_for_suggestions,
            user_text=user_text,
            answer=answer,
        )
        if followups:
            await emit(StreamEvent(type="suggestions", data={"items": followups}))

        await emit(
            StreamEvent(
                type="status",
                data={
                    "status": "answered",
                    "message_id": assistant.id,
                    "user_message_id": user_message_id,
                },
            )
        )
        await emit(StreamEvent(type="done", data={}))
