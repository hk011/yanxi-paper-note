"""统一 SSE 事件协议（解析 / 笔记 / 问答共用）"""

from typing import Any

from pydantic import BaseModel


class StreamEvent(BaseModel):
    type: str
    data: dict[str, Any] = {}

    def to_sse(self) -> str:
        import json

        payload = {"type": self.type, **self.data}
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
