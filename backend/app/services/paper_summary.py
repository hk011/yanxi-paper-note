"""解析完成后生成论文卡片一句话摘要"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from sqlmodel import Session

from app.db.models import Paper, utc_now
from app.db.session import get_engine
from app.prompts.paper_summary import PAPER_SUMMARY_SYSTEM, build_summary_user
from app.services.content_builder import build_paper_skeleton, load_content_list
from app.services.llm import complete_text
from app.services.mineru import paper_data_dir
from app.services.model_registry import resolve_model

logger = logging.getLogger(__name__)

SUMMARY_MODEL = "deepseek-v4-flash"
MAX_EXCERPT_CHARS = 3000


def _clean_summary(raw: str) -> str:
    text = (raw or "").strip()
    text = re.sub(r"^[「『\"']+|[」』\"']+$", "", text)
    text = re.sub(r"^(摘要|核心贡献)[:：]\s*", "", text)
    return text.strip()[:80]


def _load_excerpt(user_id: int, paper_id: int, paper: Paper) -> str:
    data_dir = paper_data_dir(user_id, paper_id)
    parsed = data_dir / "parsed.md"
    if parsed.exists():
        content = parsed.read_text(encoding="utf-8")
    elif paper.markdown_path and Path(paper.markdown_path).exists():
        content = Path(paper.markdown_path).read_text(encoding="utf-8")
    else:
        content = ""

    if content.strip():
        return content[:MAX_EXCERPT_CHARS]

    skeleton = build_paper_skeleton(load_content_list(data_dir), "")
    return skeleton[:MAX_EXCERPT_CHARS]


async def generate_paper_summary(
    paper_id: int, user_id: int, *, force: bool = False
) -> str:
    engine = get_engine()
    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user_id:
            return ""
        if not force and (paper.summary or "").strip():
            return paper.summary
        title = paper.title or "未命名论文"
        excerpt = _load_excerpt(user_id, paper_id, paper)
        if not excerpt.strip():
            return ""

    with Session(engine) as session:
        try:
            endpoint = resolve_model(session, user_id, SUMMARY_MODEL)
        except ValueError as exc:
            logger.warning("summary model unavailable paper_id=%s: %s", paper_id, exc)
            return ""

    messages = [
        {"role": "system", "content": PAPER_SUMMARY_SYSTEM},
        {"role": "user", "content": build_summary_user(title, excerpt)},
    ]
    try:
        raw = await complete_text(
            endpoint=endpoint,
            input_messages=messages,
            enable_thinking=False,
            timeout=60.0,
        )
    except Exception as exc:
        logger.warning("summary generation failed paper_id=%s: %s", paper_id, exc)
        return ""

    summary = _clean_summary(raw)
    if not summary:
        return ""

    with Session(engine) as session:
        paper = session.get(Paper, paper_id)
        if not paper or paper.user_id != user_id:
            return summary
        paper.summary = summary
        paper.summary_generated_at = utc_now()
        session.add(paper)
        session.commit()
    return summary
