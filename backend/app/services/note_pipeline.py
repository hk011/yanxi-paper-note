"""解读笔记生成流水线：大纲 → 并行分章节起草 → 综合重写"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from sqlmodel import Session, select

from app.core.config import get_settings
from app.db.models import Asset, Note, Paper
from app.db.session import get_engine
from app.prompts.note import (
    FINAL_NOTE_USER_TEMPLATE,
    NOTE_SYSTEM,
    OUTLINE_USER,
    SECTION_DEFS,
    SECTION_USER_TEMPLATE,
)
from app.schemas.events import StreamEvent
from app.services.ark_client import DEFAULT_TOOLS, run_with_tool_loop
from app.services.content_builder import (
    build_paper_skeleton,
    list_mineru_images,
    load_content_list,
)
from app.services.mineru import paper_data_dir
from app.services.tools.image_gen import format_tool_output, generate_figure

SECTION_CONCURRENCY = 4


async def _emit(paper_id: int, event: StreamEvent) -> None:
    from app.services.note_worker import get_note_queue

    q = get_note_queue(paper_id)
    await q.put(event)


def _rewrite_image_paths(text: str, paper_id: int) -> str:
    """将 images/xxx 转为 API 可访问路径。"""
    import re

    def repl(m: re.Match) -> str:
        rel = m.group(1)
        return f"](/api/papers/{paper_id}/files/{rel})"

    return re.sub(r"\]\((images/[^)]+)\)", repl, text)


def _enrich_event(event: StreamEvent, **extra: str) -> StreamEvent:
    data = {**event.data, **extra}
    return StreamEvent(type=event.type, data=data)


async def run_note_pipeline(paper_id: int, user_id: int, regenerate: bool = False) -> None:
    settings = get_settings()
    model = settings.model_list[0] if settings.model_list else "doubao-seed-2-0-pro-260215"
    engine = get_engine()

    try:
        await _run_note_pipeline_body(paper_id, user_id, regenerate, model, engine)
    except Exception as e:
        with Session(engine) as session:
            paper = session.get(Paper, paper_id)
            if paper:
                paper.status = "failed"
                paper.error_message = f"笔记生成失败: {e}"
                session.add(paper)
                session.commit()
        await _emit(
            paper_id,
            StreamEvent(type="status", data={"status": "failed", "error": str(e)}),
        )
        await _emit(paper_id, StreamEvent(type="done", data={}))
        from app.services.parse_worker import get_parse_queue

        await get_parse_queue(paper_id).put(None)


async def _run_note_pipeline_body(
    paper_id: int, user_id: int, regenerate: bool, model: str, engine
) -> None:
    paper_title = "论文"
    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user_id:
            return
        if paper.status not in ("parsed", "done", "noting") and not regenerate:
            return
        paper_title = paper.title

    data_dir = paper_data_dir(user_id, paper_id)
    mineru_dir = data_dir / "mineru"
    assets_dir = data_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    note_path = data_dir / "note.md"

    parsed_md = ""
    md_p = data_dir / "parsed.md"
    if md_p.exists():
        parsed_md = md_p.read_text(encoding="utf-8")

    content_list = load_content_list(data_dir)
    skeleton = build_paper_skeleton(content_list, parsed_md)
    image_list = list_mineru_images(mineru_dir)
    image_list_text = "\n".join(f"- ![]({p})" for p in image_list[:40]) or "（无提取图片）"

    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if paper:
            paper.status = "noting"
            session.add(paper)
            session.commit()

    await _emit(
        paper_id,
        StreamEvent(type="status", data={"status": "noting", "phase": "outline"}),
    )

    async def emit(ev: StreamEvent) -> None:
        await _emit(paper_id, ev)

    async def append_note(delta: str) -> None:
        with note_path.open("a", encoding="utf-8") as f:
            f.write(delta)

    if regenerate or not note_path.exists():
        note_path.write_text("", encoding="utf-8")

    # ── 阶段一：大纲 ──
    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={
                "status": "noting",
                "phase": "outline",
                "section_status": "running",
            },
        ),
    )

    outline_input = [
        {"role": "system", "content": NOTE_SYSTEM},
        {
            "role": "user",
            "content": OUTLINE_USER.format(paper_skeleton=skeleton[:14000]),
        },
    ]

    outline_parts: list[str] = []

    async def on_outline_content(delta: str) -> None:
        outline_parts.append(delta)

    async def outline_emit(ev: StreamEvent) -> None:
        await emit(_enrich_event(ev, phase="outline"))

    outline_text = await run_with_tool_loop(
        model=model,
        input_messages=outline_input,
        tools=[{"type": "web_search", "limit": 10}],
        tool_handler=_noop_tool,
        on_content=on_outline_content,
        emit=outline_emit,
        emit_content=False,
    )
    outline = outline_text or "".join(outline_parts)

    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={
                "status": "noting",
                "phase": "outline",
                "section_status": "done",
            },
        ),
    )

    generated_images: list[str] = []
    images_lock = asyncio.Lock()

    async def tool_handler(name: str, args: dict) -> str:
        if name != "gen_figure":
            return json.dumps({"message": "unknown tool"}, ensure_ascii=False)
        prompt = args.get("prompt", "")
        ref = args.get("ref_image_path")
        if ref and not Path(ref).is_absolute():
            ref = str(mineru_dir / ref)
        result = await generate_figure(prompt, assets_dir, ref)
        with Session(engine) as session:
            session.add(
                Asset(
                    paper_id=paper_id,
                    kind="ai_generated",
                    path=result["local_path"],
                    meta_json=json.dumps({"prompt": prompt}, ensure_ascii=False),
                )
            )
            session.commit()
        rel = f"assets/{Path(result['local_path']).name}"
        result["url"] = rel
        async with images_lock:
            generated_images.append(rel)
        return format_tool_output(result, paper_id)

    # ── 阶段二：并行分章节起草 ──
    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={"status": "noting", "phase": "draft"},
        ),
    )
    for section in SECTION_DEFS:
        await _emit(
            paper_id,
            StreamEvent(
                type="status",
                data={
                    "status": "noting",
                    "phase": "draft",
                    "section_id": section["id"],
                    "section": section["title"],
                    "section_status": "pending",
                },
            ),
        )

    semaphore = asyncio.Semaphore(SECTION_CONCURRENCY)

    async def draft_section(section: dict[str, str]) -> tuple[str, str, str]:
        section_id = section["id"]
        section_title = section["title"]
        instruction = section["instruction"]

        async with semaphore:
            await _emit(
                paper_id,
                StreamEvent(
                    type="status",
                    data={
                        "status": "noting",
                        "phase": "draft",
                        "section_id": section_id,
                        "section": section_title,
                        "section_status": "running",
                    },
                ),
            )

            async def section_emit(ev: StreamEvent) -> None:
                await emit(
                    _enrich_event(ev, phase="draft", section_id=section_id)
                )

            section_input = [
                {"role": "system", "content": NOTE_SYSTEM},
                {
                    "role": "user",
                    "content": SECTION_USER_TEMPLATE.format(
                        outline=outline[:6000],
                        paper_skeleton=skeleton[:10000],
                        image_list=image_list_text,
                        section_instruction=instruction,
                    ),
                },
            ]

            draft_parts: list[str] = []

            async def collect_draft(delta: str) -> None:
                draft_parts.append(delta)

            try:
                section_text = await run_with_tool_loop(
                    model=model,
                    input_messages=section_input,
                    tools=DEFAULT_TOOLS,
                    tool_handler=tool_handler,
                    on_content=collect_draft,
                    emit=section_emit,
                    emit_content=False,
                )
                draft = section_text or "".join(draft_parts)
                await _emit(
                    paper_id,
                    StreamEvent(
                        type="status",
                        data={
                            "status": "noting",
                            "phase": "draft",
                            "section_id": section_id,
                            "section": section_title,
                            "section_status": "done",
                        },
                    ),
                )
                return section_id, section_title, draft.strip()
            except Exception as e:
                await _emit(
                    paper_id,
                    StreamEvent(
                        type="status",
                        data={
                            "status": "noting",
                            "phase": "draft",
                            "section_id": section_id,
                            "section": section_title,
                            "section_status": "error",
                            "error": str(e),
                        },
                    ),
                )
                raise

    draft_results = await asyncio.gather(
        *[draft_section(section) for section in SECTION_DEFS]
    )

    section_drafts: list[str] = []
    for _section_id, section_title, draft in draft_results:
        if draft:
            section_drafts.append(f"## {section_title}\n{draft}")

    # ── 阶段三：统一综合重写，流式输出最终笔记 ──
    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={
                "status": "noting",
                "phase": "final",
                "section": "综合生成最终笔记",
                "section_status": "running",
            },
        ),
    )

    note_path.write_text("", encoding="utf-8")
    final_input = [
        {"role": "system", "content": NOTE_SYSTEM},
        {
            "role": "user",
            "content": FINAL_NOTE_USER_TEMPLATE.format(
                paper_title=paper_title,
                outline=outline[:7000],
                section_drafts="\n\n".join(section_drafts)[:20000],
                paper_skeleton=skeleton[:8000],
                image_list=image_list_text,
                generated_images="\n".join(
                    f"- ![]({path})" for path in generated_images
                )
                or "（暂无）",
            ),
        },
    ]

    async def final_emit(ev: StreamEvent) -> None:
        await emit(_enrich_event(ev, phase="final"))

    await run_with_tool_loop(
        model=model,
        input_messages=final_input,
        tools=DEFAULT_TOOLS,
        tool_handler=tool_handler,
        on_content=append_note,
        emit=final_emit,
        emit_content=True,
    )

    await _emit(
        paper_id,
        StreamEvent(
            type="status",
            data={
                "status": "noting",
                "phase": "final",
                "section": "综合生成最终笔记",
                "section_status": "done",
            },
        ),
    )

    # 后处理图片路径并入库
    raw = note_path.read_text(encoding="utf-8")
    fixed = _rewrite_image_paths(raw, paper_id)
    fixed = fixed.replace("](assets/", f"](/api/papers/{paper_id}/files/assets/")
    note_path.write_text(fixed, encoding="utf-8")

    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if paper:
            paper.status = "done"
            session.add(paper)
            session.commit()

        existing_note = session.exec(
            select(Note).where(Note.paper_id == paper_id, Note.version == 1)
        ).first()
        if existing_note:
            existing_note.md_path = str(note_path)
            existing_note.model = model
            session.add(existing_note)
        else:
            session.add(
                Note(
                    paper_id=paper_id,
                    version=1,
                    md_path=str(note_path),
                    model=model,
                )
            )
        session.commit()

    await emit(StreamEvent(type="status", data={"status": "done"}))
    await emit(StreamEvent(type="done", data={}))

    from app.services.parse_worker import get_parse_queue

    await get_parse_queue(paper_id).put(None)


async def _noop_tool(_name: str, _args: dict) -> str:
    return json.dumps({"message": "ok"}, ensure_ascii=False)
