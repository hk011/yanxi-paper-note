"""笔记生成 SSE 队列（与解析共用 paper events 通道）"""

import asyncio

from app.schemas.events import StreamEvent

_note_queues: dict[int, asyncio.Queue[StreamEvent | None]] = {}


def get_note_queue(paper_id: int) -> asyncio.Queue[StreamEvent | None]:
    from app.services.parse_worker import get_parse_queue

    return get_parse_queue(paper_id)
