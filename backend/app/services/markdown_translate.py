from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from pathlib import Path

from sqlmodel import Session

from app.schemas.events import StreamEvent
from app.services.llm import stream_complete_text
from app.services.mineru import paper_data_dir
from app.services.model_registry import resolve_model

ALLOWED_TRANSLATE_MODELS = frozenset({"deepseek-v4-flash"})

_TRANSLATE_PROMPT = """请将以下 Markdown 学术论文内容翻译成流畅、准确的中文。
要求：
1. 保留所有 Markdown 结构（标题层级、列表、代码块、表格、链接、图片语法等）
2. 图片路径、代码块内容、数学公式保持原样，仅翻译自然语言部分
3. 不要添加解释或前言，直接输出翻译后的 Markdown

原文：
"""


def translation_path(user_id: int, paper_id: int) -> Path:
    return paper_data_dir(user_id, paper_id) / "markdown_zh.md"


def translation_meta_path(user_id: int, paper_id: int) -> Path:
    return paper_data_dir(user_id, paper_id) / "markdown_zh.meta.json"


def has_translation(user_id: int, paper_id: int) -> bool:
    path = translation_path(user_id, paper_id)
    return path.exists() and path.stat().st_size > 0


def load_translation(user_id: int, paper_id: int) -> str:
    path = translation_path(user_id, paper_id)
    if not path.exists():
        raise FileNotFoundError("中文翻译不存在")
    return path.read_text(encoding="utf-8")


def _chunk_markdown(text: str, max_chars: int = 10000) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in text.splitlines(keepends=True):
        if current_len + len(line) > max_chars and current:
            chunks.append("".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += len(line)
    if current:
        chunks.append("".join(current))
    return chunks


async def run_translate_markdown_stream(
    *,
    session: Session,
    user_id: int,
    paper_id: int,
    source_markdown: str,
    model_key: str,
    emit: Callable[[StreamEvent], Awaitable[None]],
) -> str:
    key = (model_key or "deepseek-v4-flash").strip()
    if key not in ALLOWED_TRANSLATE_MODELS:
        raise ValueError("当前仅支持 deepseek-v4-flash 模型")

    endpoint = resolve_model(session, user_id, key)
    chunks = _chunk_markdown(source_markdown)
    translated_parts: list[str] = []
    total = len(chunks)

    for index, chunk in enumerate(chunks):
        await emit(
            StreamEvent(
                type="status",
                data={
                    "phase": "translating",
                    "chunk": index + 1,
                    "total": total,
                },
            )
        )
        if index > 0:
            separator = "\n\n"
            translated_parts.append(separator)
            await emit(StreamEvent(type="content", data={"delta": separator}))

        messages = [{"role": "user", "content": _TRANSLATE_PROMPT + chunk}]
        part = await stream_complete_text(
            endpoint=endpoint,
            input_messages=messages,
            emit=emit,
            enable_thinking=False,
            timeout=300.0,
        )
        if not part.strip():
            raise RuntimeError(f"翻译失败：第 {index + 1} 段返回为空")
        translated_parts.append(part.strip())

    result = "".join(translated_parts)
    data_dir = paper_data_dir(user_id, paper_id)
    data_dir.mkdir(parents=True, exist_ok=True)
    out_path = translation_path(user_id, paper_id)
    out_path.write_text(result, encoding="utf-8")
    meta_path = translation_meta_path(user_id, paper_id)
    meta_path.write_text(
        json.dumps({"model": key, "chunks": len(chunks)}, ensure_ascii=False),
        encoding="utf-8",
    )
    return result
