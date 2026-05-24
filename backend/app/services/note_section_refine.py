"""笔记小节润色"""

from __future__ import annotations

import re

from sqlmodel import Session

from app.db.session import get_engine
from app.prompts.note_section_refine import (
    NOTE_SECTION_REFINE_SYSTEM,
    NOTE_SECTION_REFINE_USER,
)
from app.schemas.events import StreamEvent
from app.services.llm import run_with_tool_loop
from app.services.model_registry import resolve_model
from app.services.mineru import paper_data_dir
from app.services.note_sections import find_section_range, replace_section_body


def _strip_section_heading(text: str, heading: str) -> str:
    lines = text.strip().splitlines()
    if not lines:
        return ""
    first = lines[0].strip()
    if re.match(r"^#{1,6}\s+", first):
        return "\n".join(lines[1:]).strip()
    if heading and heading in first and first.startswith("#"):
        return "\n".join(lines[1:]).strip()
    return text.strip()


async def run_section_refine(
    *,
    paper_id: int,
    user_id: int,
    heading: str,
    instruction: str,
    model: str,
    enable_thinking: bool,
    enable_search: bool,
    emit,
) -> None:
    data_dir = paper_data_dir(user_id, paper_id)
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")

    raw = note_path.read_text(encoding="utf-8")
    _, _, section_body = find_section_range(raw, heading)
    inst = (instruction or "").strip()
    if not inst:
        raise ValueError("请填写润色要求")

    engine = get_engine()
    with Session(engine) as session:
        endpoint = resolve_model(session, user_id, model or "")

    user_prompt = NOTE_SECTION_REFINE_USER.format(
        heading=heading,
        section_body=section_body or "（本节暂无正文）",
        instruction=inst,
    )
    input_messages = [
        {"role": "system", "content": NOTE_SECTION_REFINE_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    tools: list[dict] = []
    if enable_search:
        tools.insert(0, {"type": "web_search", "limit": 10})

    content_parts: list[str] = []

    async def on_content(delta: str) -> None:
        content_parts.append(delta)
        await emit(StreamEvent(type="content", data={"delta": delta}))

    async def on_emit(ev: StreamEvent) -> None:
        if ev.type in ("thinking", "tool_start", "tool_end", "references", "usage"):
            await emit(ev)

    await emit(StreamEvent(type="status", data={"status": "refining"}))

    try:
        refined = await run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=tools,
            tool_handler=_noop_section_tool,
            on_content=on_content,
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

    refined_body = _strip_section_heading(
        (refined or "".join(content_parts)).strip(),
        heading,
    )
    if not refined_body:
        await emit(
            StreamEvent(
                type="status",
                data={"status": "failed", "error": "模型未返回有效小节内容"},
            )
        )
        await emit(StreamEvent(type="done", data={}))
        return

    merged = replace_section_body(raw, heading, refined_body)

    await emit(
        StreamEvent(
            type="status",
            data={
                "status": "refined",
                "heading": heading,
                "merged_content": merged,
                "model": endpoint.key,
            },
        )
    )
    await emit(StreamEvent(type="done", data={"content_length": len(refined_body)}))


async def _noop_section_tool(name: str, _args: dict) -> str:
    import json

    if name in ("web_search", "search"):
        return json.dumps({"message": "ok"}, ensure_ascii=False)
    return json.dumps(
        {"message": f"本节润色不支持工具 {name}"}, ensure_ascii=False
    )
