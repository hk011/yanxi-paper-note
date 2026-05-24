"""笔记小节内嵌：生成配图并写入 markdown"""

from __future__ import annotations

import json

from sqlmodel import Session

from app.db.models import Asset
from app.db.session import get_engine
from app.services.mineru import paper_data_dir
from app.services.note_refine import apply_refined_note
from app.services.note_sections import (
    find_section_range,
    insert_figure_after_heading,
    next_gen_image_rel,
)
from app.services.figure_prompt import (
    build_academic_figure_prompt,
    infer_figure_profile,
    resolve_figure_size,
)
from app.services.tools.image_gen import generate_figure


async def add_figure_to_section(
    *,
    paper_id: int,
    user_id: int,
    heading: str,
    instruction: str = "",
) -> dict:
    data_dir = paper_data_dir(user_id, paper_id)
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")

    raw = note_path.read_text(encoding="utf-8")
    _, _, body = find_section_range(raw, heading)
    profile = infer_figure_profile(heading, f"{body} {(instruction or '').strip()}")
    prompt = build_academic_figure_prompt(
        heading=heading,
        reference_knowledge=body,
        instruction=instruction,
        profile=profile,
    )
    size = resolve_figure_size(profile)

    dest, rel = next_gen_image_rel(data_dir)
    result = await generate_figure(
        prompt,
        dest.parent,
        ref_image_path=None,
        filename=dest.name,
        rel_path=rel,
        size=size,
    )

    engine = get_engine()
    with Session(engine) as session:
        session.add(
            Asset(
                paper_id=paper_id,
                kind="ai_generated",
                path=result["local_path"],
                meta_json=json.dumps(
                    {"prompt": prompt, "section": heading}, ensure_ascii=False
                ),
            )
        )
        session.commit()

    merged = insert_figure_after_heading(raw, heading, rel, alt=heading)
    saved = apply_refined_note(
        paper_id=paper_id,
        user_id=user_id,
        content=merged,
        model="",
    )
    return {**saved, "image_path": rel, "heading": heading}
