"""解析/摘要完成后生成卡片 AI 封面（商汤 SenseNova）"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from sqlmodel import Session

from app.db.models import Paper
from app.db.session import get_engine
from app.prompts.paper_cover import build_cover_prompt
from app.services.mineru import paper_data_dir
from app.services.tools.image_gen import generate_cover
from app.utils.folder_theme import get_paper_cover_palette

logger = logging.getLogger(__name__)

# backfill 会同时排队多篇，商汤侧限流/排队时易超时，串行生成
_cover_gen_semaphore = asyncio.Semaphore(1)


def cover_file_path(user_id: int, paper_id: int) -> Path:
    return paper_data_dir(user_id, paper_id) / "cover.jpg"


async def generate_paper_cover(paper_id: int, user_id: int, *, force: bool = False) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user_id:
            return False
        if not force and paper.cover_status == "done" and paper.cover_path:
            path = Path(paper.cover_path)
            if path.exists() and path.stat().st_size > 0:
                return True
        title = paper.title or "未命名论文"
        summary = paper.summary or ""
        palette = get_paper_cover_palette(session, user_id, paper_id)
        paper.cover_status = "generating"
        session.add(paper)
        session.commit()

    out = cover_file_path(user_id, paper_id)
    prompt = build_cover_prompt(title=title, summary=summary, palette=palette)
    logger.info("cover prompt paper_id=%s: %s", paper_id, prompt)
    try:
        async with _cover_gen_semaphore:
            await generate_cover(prompt=prompt, output_path=out)
    except Exception as exc:
        logger.warning(
            "cover generation failed paper_id=%s: %s", paper_id, exc, exc_info=True
        )
        with Session(engine) as session:
            paper = session.get(Paper, paper_id)
            if paper:
                paper.cover_status = "failed"
                session.add(paper)
                session.commit()
        return False

    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if not paper:
            return False
        paper.cover_path = str(out)
        paper.cover_status = "done"
        session.add(paper)
        session.commit()
    return True
