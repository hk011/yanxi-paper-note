"""笔记正文：图片路径规范化与 gen_figure 补全"""

from __future__ import annotations

import json
import re
from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Message

_API_IMG_RE = re.compile(
    r"!\[([^\]]*)\]\(/api/papers/\d+/files/([^)]+)\)"
)

def normalize_note_image_refs(content: str, paper_id: int | None = None) -> str:
    """将 /api/papers/{id}/files/... 转为相对路径，便于持久化与渲染。"""
    if not content:
        return content

    def _repl(m: re.Match) -> str:
        alt, rel = m.group(1), m.group(2).lstrip("/")
        return f"![{alt}]({rel})"

    text = _API_IMG_RE.sub(_repl, content)
    if paper_id is not None:
        prefix = f"/api/papers/{paper_id}/files/"
        text = re.sub(
            rf"!\[([^\]]*)\]\({re.escape(prefix)}([^)]+)\)",
            r"![\1](\2)",
            text,
        )
    return text


def _parse_gen_figure_output(raw: object) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        data = raw
    elif isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
    else:
        return None
    rel = data.get("image_url")
    if isinstance(rel, str) and rel.strip():
        return rel.strip().lstrip("/")
    return None


def collect_gen_figure_paths_from_tool_trace(tool_trace: list | None) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for raw in tool_trace or []:
        if not isinstance(raw, dict):
            continue
        if raw.get("type") != "tool_end" or raw.get("tool") != "gen_figure":
            continue
        rel = _parse_gen_figure_output(raw.get("output"))
        if rel and rel not in seen:
            seen.add(rel)
            paths.append(rel)
    return paths


def collect_gen_figure_paths_from_messages(messages: list[Message]) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for msg in messages:
        if msg.role != "assistant":
            continue
        try:
            trace = json.loads(msg.tool_trace_json or "[]")
        except json.JSONDecodeError:
            trace = []
        for rel in collect_gen_figure_paths_from_tool_trace(trace):
            if rel not in seen:
                seen.add(rel)
                paths.append(rel)
    return paths


def merge_missing_gen_figures(
    content: str,
    figure_paths: list[str],
    *,
    insert_before: str = "## 二、",
) -> str:
    """将本次会话生成但未写入正文的配图插入笔记。"""
    if not figure_paths:
        return content
    missing = [p for p in figure_paths if p not in content]
    if not missing:
        return content
    block_lines = ["", "方法总览图（AI 生成）：", ""]
    for rel in missing:
        block_lines.append(f"![]({rel})")
        block_lines.append("")
    block = "\n".join(block_lines).rstrip() + "\n\n"
    if insert_before in content:
        return content.replace(insert_before, block + insert_before, 1)
    return content.rstrip() + "\n\n" + block


def list_unreferenced_gen_assets(data_dir: Path, content: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for folder in ("assets", "images/gen"):
        base = data_dir / folder
        if not base.is_dir():
            continue
        for p in sorted(base.glob("gen_*.png")):
            rel = f"{folder}/{p.name}"
            if rel not in content and p.name not in content and rel not in seen:
                seen.add(rel)
                out.append(rel)
    return out


def prepare_note_content_for_save(
    *,
    content: str,
    paper_id: int,
    data_dir: Path,
    session: Session | None = None,
    conversation_id: int | None = None,
    assistant_message_id: int | None = None,
    auto_insert_orphans: bool = False,
) -> str:
    """规范化图片路径；可选将未引用的 gen 配图追加到文末（仅 repair 等兜底场景）。"""
    text = normalize_note_image_refs(content, paper_id)

    if not auto_insert_orphans:
        return text

    figure_paths: list[str] = []
    if session and conversation_id is not None:
        q = select(Message).where(Message.conversation_id == conversation_id)
        if assistant_message_id is not None:
            q = q.where(Message.id <= assistant_message_id)
        msgs = session.exec(q.order_by(Message.created_at.asc())).all()
        figure_paths.extend(collect_gen_figure_paths_from_messages(list(msgs)))
    figure_paths.extend(list_unreferenced_gen_assets(data_dir, text))

    seen: set[str] = set()
    unique_paths: list[str] = []
    for p in figure_paths:
        if p not in seen:
            seen.add(p)
            unique_paths.append(p)

    if unique_paths:
        text = merge_missing_gen_figures(text, unique_paths)
    return normalize_note_image_refs(text, paper_id)
