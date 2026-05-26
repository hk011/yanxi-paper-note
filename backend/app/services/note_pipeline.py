"""解读笔记生成流水线：大纲 → 并行分章节起草 → 综合重写"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Asset, Note, Paper
from app.db.session import get_engine
from app.prompts.note import (
    FINAL_NOTE_USER_TEMPLATE,
    SECTION_DEFS,
    SECTION_USER_TEMPLATE,
    build_note_system,
    build_outline_user,
    section_instruction,
)
from app.schemas.events import StreamEvent
from app.services.ark_client import GEN_FIGURE_TOOL
from app.services.search_tools import (
    build_search_tools,
    search_enabled_for_endpoint,
    wrap_tool_handler_with_web_search,
)
from app.services.content_builder import (
    build_image_catalog,
    build_paper_skeleton,
    format_image_catalog,
    load_content_list,
)
from app.services.llm import run_with_tool_loop as llm_run_with_tool_loop
from app.services.model_registry import ModelEndpoint, resolve_model
from app.services.mineru import paper_data_dir
from app.services.note_generation_trace import (
    NoteGenerationTraceCollector,
    delete_generation_trace,
)
from app.prompts.image_gen import NOTE_FIGURE_SIZE
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


async def run_note_pipeline(
    paper_id: int,
    user_id: int,
    regenerate: bool = False,
    model_key: str = "",
) -> None:
    engine = get_engine()
    endpoint: ModelEndpoint | None = None
    with Session(engine) as session:
        try:
            endpoint = resolve_model(session, user_id, model_key)
        except ValueError as e:
            await _emit(
                paper_id,
                StreamEvent(type="status", data={"status": "failed", "error": str(e)}),
            )
            await _emit(paper_id, StreamEvent(type="done", data={}))
            return

    try:
        await _run_note_pipeline_body(
            paper_id, user_id, regenerate, endpoint, engine
        )
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
    paper_id: int, user_id: int, regenerate: bool, endpoint: ModelEndpoint, engine
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
    image_catalog = build_image_catalog(content_list, parsed_md)
    image_list_text = format_image_catalog(image_catalog)

    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if paper:
            paper.status = "noting"
            session.add(paper)
            session.commit()

    enable_web_search = search_enabled_for_endpoint(endpoint)
    use_thinking = endpoint.provider == "ark"
    note_system = build_note_system(enable_web_search=enable_web_search)
    outline_user_template = build_outline_user(enable_web_search=enable_web_search)
    search_tools = build_search_tools(endpoint, enable_search=enable_web_search)
    outline_tools = search_tools if search_tools else None
    note_tools = list(search_tools) + [GEN_FIGURE_TOOL]

    if regenerate or not note_path.exists():
        note_path.write_text("", encoding="utf-8")
        delete_generation_trace(data_dir)

    trace_collector = NoteGenerationTraceCollector()

    async def pipeline_emit(ev: StreamEvent) -> None:
        trace_collector.record(ev)
        await _emit(paper_id, ev)

    async def append_note(delta: str) -> None:
        with note_path.open("a", encoding="utf-8") as f:
            f.write(delta)

    await pipeline_emit(
        StreamEvent(type="status", data={"status": "noting", "phase": "outline"}),
    )

    # ── 阶段一：大纲 ──
    await pipeline_emit(
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
        {"role": "system", "content": note_system},
        {
            "role": "user",
            "content": outline_user_template.format(
                paper_skeleton=skeleton[:14000],
                image_list=image_list_text[:12000],
            ),
        },
    ]

    outline_parts: list[str] = []

    async def on_outline_content(delta: str) -> None:
        outline_parts.append(delta)

    async def outline_emit(ev: StreamEvent) -> None:
        await pipeline_emit(_enrich_event(ev, phase="outline"))

    outline_text = await llm_run_with_tool_loop(
        endpoint=endpoint,
        input_messages=outline_input,
        tools=outline_tools,
        tool_handler=wrap_tool_handler_with_web_search(
            _noop_tool, emit=outline_emit, endpoint=endpoint
        ),
        on_content=on_outline_content,
        emit=outline_emit,
        emit_content=False,
        enable_thinking=use_thinking,
    )
    outline = outline_text or "".join(outline_parts)

    await pipeline_emit(
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

    async def _note_tool_core(name: str, args: dict) -> str:
        if name != "gen_figure":
            return json.dumps({"message": "unknown tool"}, ensure_ascii=False)
        prompt = args.get("prompt", "")
        ref = args.get("ref_image_path")
        if ref and not Path(ref).is_absolute():
            ref = str(mineru_dir / ref)
        result = await generate_figure(
            prompt, assets_dir, ref, size=NOTE_FIGURE_SIZE
        )
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
    await pipeline_emit(
        StreamEvent(
            type="status",
            data={"status": "noting", "phase": "draft"},
        ),
    )
    for section in SECTION_DEFS:
        await pipeline_emit(
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

        async with semaphore:
            await pipeline_emit(
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
                await pipeline_emit(
                    _enrich_event(ev, phase="draft", section_id=section_id)
                )

            section_input = [
                {"role": "system", "content": note_system},
                {
                    "role": "user",
                    "content": SECTION_USER_TEMPLATE.format(
                        outline=outline[:6000],
                        paper_skeleton=skeleton[:10000],
                        image_list=image_list_text,
                        section_instruction=section_instruction(
                            section, enable_web_search=enable_web_search
                        ),
                    ),
                },
            ]

            draft_parts: list[str] = []

            async def collect_draft(delta: str) -> None:
                draft_parts.append(delta)

            try:
                section_tool_handler = wrap_tool_handler_with_web_search(
                    _note_tool_core, emit=section_emit, endpoint=endpoint
                )
                section_text = await llm_run_with_tool_loop(
                    endpoint=endpoint,
                    input_messages=section_input,
                    tools=note_tools,
                    tool_handler=section_tool_handler,
                    on_content=collect_draft,
                    emit=section_emit,
                    emit_content=False,
                    enable_thinking=use_thinking,
                )
                draft = section_text or "".join(draft_parts)
                await pipeline_emit(
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
                await pipeline_emit(
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
    await pipeline_emit(
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
        {"role": "system", "content": note_system},
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
        await pipeline_emit(_enrich_event(ev, phase="final"))

    final_tool_handler = wrap_tool_handler_with_web_search(
        _note_tool_core, emit=final_emit, endpoint=endpoint
    )
    await llm_run_with_tool_loop(
        endpoint=endpoint,
        input_messages=final_input,
        tools=note_tools,
        tool_handler=final_tool_handler,
        on_content=append_note,
        emit=final_emit,
        emit_content=True,
        enable_thinking=use_thinking,
    )

    await pipeline_emit(
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

    trace_collector.save(data_dir)

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
            existing_note.model = endpoint.key
            session.add(existing_note)
        else:
            session.add(
                Note(
                    paper_id=paper_id,
                    version=1,
                    md_path=str(note_path),
                    model=endpoint.key,
                )
            )
        session.commit()

    await pipeline_emit(StreamEvent(type="status", data={"status": "done"}))
    await pipeline_emit(StreamEvent(type="done", data={}))

    from app.services.parse_worker import get_parse_queue

    await get_parse_queue(paper_id).put(None)


async def _noop_tool(_name: str, _args: dict) -> str:
    return json.dumps({"message": "ok"}, ensure_ascii=False)
