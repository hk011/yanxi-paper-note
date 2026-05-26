"""笔记小节内嵌：生成配图并写入 markdown"""

from __future__ import annotations

import json
import logging

from sqlmodel import Session

from app.db.models import Asset
from app.db.session import get_engine
from app.prompts.image_gen import NOTE_FIGURE_SIZE
from app.services.figure_prompt import build_academic_figure_prompt, infer_figure_profile
from app.services.figure_prompt_optimizer import optimize_section_figure_prompt
from app.services.mineru import paper_data_dir
from app.services.note_refine import apply_refined_note
from app.services.note_sections import (
    find_action_section_range,
    insert_figure_after_heading,
    next_gen_image_rel,
)
from app.services.tools.image_gen import generate_figure

logger = logging.getLogger(__name__)


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
    _, _, body, scope_heading = find_action_section_range(raw, heading)

    optimizer_used = True
    try:
        prompt = await optimize_section_figure_prompt(
            data_dir=data_dir,
            heading=scope_heading,
            section_body=body,
            user_instruction=instruction,
        )
    except Exception as e:
        optimizer_used = False
        logger.warning("小节配图多模态优化失败，使用规则兜底: %s", e)
        profile = infer_figure_profile(
            scope_heading, f"{body} {(instruction or '').strip()}"
        )
        prompt = build_academic_figure_prompt(
            heading=scope_heading,
            instruction=instruction,
            profile=profile,
            section_body=body,
        )

    dest, rel = next_gen_image_rel(data_dir)
    logger.info(
        "小节配图 prompt paper=%s section=%s optimizer=%s file=%s prompt=%s",
        paper_id,
        scope_heading,
        optimizer_used,
        rel,
        prompt[:500],
    )
    result = await generate_figure(
        prompt,
        dest.parent,
        ref_image_path=None,
        filename=dest.name,
        rel_path=rel,
        size=NOTE_FIGURE_SIZE,
    )

    engine = get_engine()
    with Session(engine) as session:
        session.add(
            Asset(
                paper_id=paper_id,
                kind="ai_generated",
                path=result["local_path"],
                meta_json=json.dumps(
                    {
                        "prompt": result.get("prompt", prompt),
                        "section": scope_heading,
                        "optimizer": optimizer_used,
                    },
                    ensure_ascii=False,
                ),
            )
        )
        session.commit()

    merged = insert_figure_after_heading(
        raw, scope_heading, rel, alt=scope_heading
    )
    saved = apply_refined_note(
        paper_id=paper_id,
        user_id=user_id,
        content=merged,
        model="section_figure",
    )
    return {**saved, "image_path": rel, "heading": scope_heading}
