"""笔记小节润色"""

from __future__ import annotations

import re
from pathlib import Path

from sqlmodel import Session

from app.db.session import get_engine
from app.prompts.note_section_refine import (
    NOTE_SECTION_REFINE_SYSTEM,
    NOTE_SECTION_REFINE_USER,
)
from app.schemas.events import StreamEvent
from app.services.figure_prompt_optimizer import list_section_image_paths
from app.services.llm import run_with_tool_loop
from app.services.model_registry import resolve_model
from app.services.search_tools import (
    build_search_tools,
    wrap_tool_handler_with_web_search,
)
from app.services.mineru import paper_data_dir
from app.services.multimodal_input import (
    build_multimodal_user_content,
    model_supports_vision,
    resolve_attachment_paths,
)
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


def _merge_image_paths(
    section_paths: list[Path],
    extra_paths: list[Path],
    *,
    max_count: int = 8,
) -> list[Path]:
    seen: set[Path] = set()
    merged: list[Path] = []
    for p in section_paths + extra_paths:
        key = p.resolve()
        if key in seen:
            continue
        seen.add(key)
        merged.append(p)
        if len(merged) >= max_count:
            break
    return merged


def _build_refine_user_text(
    *,
    heading: str,
    section_body: str,
    instruction: str,
    image_count: int,
    vision_used: bool,
    vision_skipped_reason: str = "",
) -> str:
    img_block = ""
    if image_count > 0:
        if vision_used:
            img_block = (
                f"【图片】共 {image_count} 张（本节引用 + 你补充上传）已作为视觉输入附在消息前，"
                "请结合图文理解后再润色。\n\n"
            )
        elif vision_skipped_reason:
            img_block = f"【图片说明】{vision_skipped_reason}\n\n"
    return (
        img_block
        + NOTE_SECTION_REFINE_USER.format(
            heading=heading,
            section_body=section_body or "（本节暂无正文）",
            instruction=instruction,
        )
    )


async def run_section_refine(
    *,
    paper_id: int,
    user_id: int,
    heading: str,
    instruction: str,
    model: str,
    enable_thinking: bool,
    enable_search: bool,
    attachments: list[dict] | None = None,
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

    section_paths = list_section_image_paths(
        data_dir, section_body, skip_gen=False
    )
    extra_paths = resolve_attachment_paths(data_dir, attachments)
    all_paths = _merge_image_paths(section_paths, extra_paths)
    vision = model_supports_vision(endpoint)

    vision_skipped_reason = ""
    if all_paths and not vision:
        names = ", ".join(p.name for p in all_paths[:5])
        if len(all_paths) > 5:
            names += " 等"
        vision_skipped_reason = (
            f"当前模型（{endpoint.label}）不支持识图，以下图片不会上传：{names}。"
            "请仅依据下方文字润色；如需结合图片，请改用内置多模态模型。"
        )

    user_text = _build_refine_user_text(
        heading=heading,
        section_body=section_body,
        instruction=inst,
        image_count=len(all_paths),
        vision_used=vision and bool(all_paths),
        vision_skipped_reason=vision_skipped_reason,
    )

    if vision and all_paths:
        user_content: str | list[dict] = build_multimodal_user_content(
            text=user_text,
            image_paths=all_paths,
        )
    else:
        user_content = user_text

    input_messages = [
        {"role": "system", "content": NOTE_SECTION_REFINE_SYSTEM},
        {"role": "user", "content": user_content},
    ]

    tools: list[dict] = build_search_tools(endpoint, enable_search=enable_search)

    content_parts: list[str] = []

    async def on_content(delta: str) -> None:
        content_parts.append(delta)
        await emit(StreamEvent(type="content", data={"delta": delta}))

    async def on_emit(ev: StreamEvent) -> None:
        if ev.type in (
            "thinking",
            "tool_start",
            "tool_delta",
            "tool_end",
            "references",
            "usage",
        ):
            await emit(ev)

    await emit(
        StreamEvent(
            type="status",
            data={
                "status": "refining",
                "vision_used": vision and bool(all_paths),
                "vision_skipped": bool(all_paths) and not vision,
                "section_image_count": len(section_paths),
                "extra_image_count": len(extra_paths),
            },
        )
    )

    try:
        refined = await run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=tools,
            tool_handler=wrap_tool_handler_with_web_search(
                _noop_section_tool, emit=on_emit, endpoint=endpoint
            ),
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
