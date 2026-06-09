"""解析完成后的卡片 enrichment：摘要 + AI 封面（异步旁路）"""

from __future__ import annotations

import asyncio
import logging

from app.services.paper_cover import generate_paper_cover
from app.services.paper_summary import generate_paper_summary

logger = logging.getLogger(__name__)


async def run_paper_enrichment(paper_id: int, user_id: int, *, force: bool = False) -> None:
    try:
        await generate_paper_summary(paper_id, user_id, force=force)
    except Exception as exc:
        logger.warning(
            "paper enrichment summary failed paper_id=%s: %s", paper_id, exc
        )
    try:
        await generate_paper_cover(paper_id, user_id, force=force)
    except Exception as exc:
        logger.warning(
            "paper enrichment cover failed paper_id=%s: %s", paper_id, exc
        )


def schedule_paper_enrichment(paper_id: int, user_id: int, *, force: bool = False) -> None:
    asyncio.create_task(run_paper_enrichment(paper_id, user_id, force=force))
