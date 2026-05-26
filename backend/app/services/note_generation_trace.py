"""笔记生成过程持久化（文件存储，与 note.md 同目录）"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from app.prompts.note import SECTION_DEFS
from app.schemas.events import StreamEvent

TRACE_FILENAME = "note_generation_trace.json"
THINKING_CONTENT_MAX = 8000
TOOL_HITS_MAX = 20


def trace_path(data_dir: Path) -> Path:
    return data_dir / TRACE_FILENAME


def initial_section_progress() -> dict[str, str]:
    return {section["id"]: "pending" for section in SECTION_DEFS}


def _merge_hits(
    existing: list[Any] | None, incoming: list[Any] | None
) -> list[Any] | None:
    if not incoming:
        return existing
    base = list(existing or [])
    seen: set[str] = set()
    for item in base:
        if isinstance(item, dict):
            seen.add(json.dumps(item, sort_keys=True, ensure_ascii=False))
    for item in incoming:
        if not isinstance(item, dict):
            base.append(item)
            continue
        key = json.dumps(item, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            base.append(item)
    return base[:TOOL_HITS_MAX] if len(base) > TOOL_HITS_MAX else base


def _truncate_thinking(text: str) -> str:
    if len(text) <= THINKING_CONTENT_MAX:
        return text
    return text[:THINKING_CONTENT_MAX] + "…"


class NoteGenerationTraceCollector:
    """聚合 SSE 事件为前端可直接恢复的 pipeline 状态。"""

    def __init__(self) -> None:
        self.timeline: list[dict[str, Any]] = []
        self.section_timelines: dict[str, list[dict[str, Any]]] = {}
        self.section_progress: dict[str, str] = initial_section_progress()
        self.pipeline_phase: str = ""
        self.outline_status: str = "pending"
        self.final_status: str = "pending"
        self._step_counter = 0

    def _timeline_key(self, data: dict[str, Any]) -> str:
        if data.get("section_id"):
            return str(data["section_id"])
        phase = data.get("phase")
        if phase == "outline":
            return "_outline"
        if phase == "final":
            return "_final"
        return "default"

    def _items(self, key: str) -> list[dict[str, Any]]:
        if key not in self.section_timelines:
            self.section_timelines[key] = []
        return self.section_timelines[key]

    def _next_key(self, prefix: str) -> str:
        self._step_counter += 1
        return f"{prefix}-{int(time.time() * 1000)}-{self._step_counter}"

    def _commit(self, key: str, items: list[dict[str, Any]]) -> None:
        self.section_timelines[key] = items
        if key in ("default", "_final", "_outline"):
            self.timeline = list(items)

    def record(self, event: StreamEvent) -> None:
        typ = event.type
        data = event.data

        if typ == "status":
            self._record_status(data)
            return
        if typ in ("content", "usage", "suggestions", "done"):
            return

        key = self._timeline_key(data)
        items = self._items(key)

        if typ == "thinking":
            delta = data.get("delta") or ""
            if not delta:
                return
            if items and items[-1].get("kind") == "thinking" and items[-1].get("status") == "pending":
                prev = items[-1].get("content") or ""
                items[-1]["content"] = _truncate_thinking(f"{prev}{delta}")
            else:
                items.append(
                    {
                        "key": self._next_key(f"thinking-{key}"),
                        "kind": "thinking",
                        "status": "pending",
                        "content": _truncate_thinking(delta),
                    }
                )
            self._commit(key, items)
            return

        if typ == "tool_start":
            if items and items[-1].get("kind") == "thinking" and items[-1].get("status") == "pending":
                items[-1]["status"] = "success"
            tool = data.get("tool") or "tool"
            call_id = data.get("call_id") or ""
            item_key = call_id or self._next_key(tool)
            desc = (
                "正在检索…"
                if tool == "web_search"
                else "正在生成说明图…"
                if tool == "gen_figure"
                else None
            )
            items.append(
                {
                    "key": item_key,
                    "kind": "tool",
                    "status": "pending",
                    "tool": tool,
                    "callId": call_id,
                    "input": data.get("input"),
                    "content": desc,
                }
            )
            self._commit(key, items)
            return

        if typ == "tool_delta":
            q = data.get("query")
            call_id = data.get("call_id")
            hits = data.get("hits")
            updated: list[dict[str, Any]] = []
            for t in items:
                if t.get("kind") != "tool" or not self._matches_tool(t, tool=data.get("tool"), call_id=call_id):
                    updated.append(t)
                    continue
                next_item = dict(t)
                if q:
                    next_item["content"] = f"搜索：{q}"
                    inp = dict(next_item.get("input") or {})
                    inp["query"] = q
                    next_item["input"] = inp
                if hits is not None:
                    next_item["hits"] = _merge_hits(next_item.get("hits"), hits)
                updated.append(next_item)
            self._commit(key, updated)
            return

        if typ == "references":
            q = data.get("query")
            ref_items = data.get("items")
            if not isinstance(ref_items, list):
                return
            updated = []
            for t in items:
                if t.get("kind") != "tool" or t.get("tool") != "web_search":
                    updated.append(t)
                    continue
                next_item = dict(t)
                if q:
                    inp = dict(next_item.get("input") or {})
                    inp["query"] = q
                    next_item["input"] = inp
                next_item["hits"] = _merge_hits(next_item.get("hits"), ref_items)
                updated.append(next_item)
            self._commit(key, updated)
            return

        if typ == "tool_end":
            q = data.get("query")
            call_id = data.get("call_id")
            tool = data.get("tool")
            output = data.get("output")
            hits = data.get("hits")
            updated = []
            for t in items:
                if t.get("kind") != "tool" or not self._matches_tool_end(t, data):
                    updated.append(t)
                    continue
                next_item = dict(t)
                next_item["status"] = "success" if data.get("status") == "success" else "error"
                if q:
                    inp = dict(next_item.get("input") or {})
                    inp["query"] = q
                    next_item["input"] = inp
                if hits is not None or output is not None:
                    next_item["hits"] = _merge_hits(next_item.get("hits"), hits)
                if output is not None:
                    next_item["output"] = output
                updated.append(next_item)
            self._commit(key, updated)
            return

    def _matches_tool(
        self, item: dict[str, Any], *, tool: str | None, call_id: str | None
    ) -> bool:
        if call_id and (item.get("callId") == call_id or item.get("key") == call_id):
            return True
        return tool == "web_search" and item.get("tool") == "web_search"

    def _matches_tool_end(self, item: dict[str, Any], data: dict[str, Any]) -> bool:
        if self._matches_tool(item, tool=data.get("tool"), call_id=data.get("call_id")):
            return True
        return (
            data.get("tool") == "gen_figure"
            and item.get("tool") == "gen_figure"
            and item.get("status") == "pending"
        )

    def _record_status(self, data: dict[str, Any]) -> None:
        if data.get("status") == "noting" and data.get("phase") == "outline" and not data.get(
            "section_status"
        ):
            self.pipeline_phase = "outline"
            self.outline_status = "pending"
            self.final_status = "pending"
            self.section_progress = initial_section_progress()

        phase = data.get("phase")
        if phase:
            self.pipeline_phase = phase

        if phase == "outline" and data.get("section_status"):
            self.outline_status = data["section_status"]

        if phase == "final" and data.get("section_status"):
            self.final_status = data["section_status"]

        if phase == "draft" and data.get("section_id") and data.get("section_status"):
            self.section_progress[data["section_id"]] = data["section_status"]

    def finalize(self) -> None:
        for key, items in list(self.section_timelines.items()):
            next_items = [
                {**t, "status": "success"} if t.get("status") == "pending" else t
                for t in items
            ]
            self._commit(key, next_items)

        self.outline_status = "done"
        self.final_status = "done"
        self.section_progress = {section["id"]: "done" for section in SECTION_DEFS}
        self.pipeline_phase = ""

    def to_state(self) -> dict[str, Any]:
        return {
            "timeline": self.timeline,
            "sectionTimelines": self.section_timelines,
            "sectionProgress": self.section_progress,
            "pipelinePhase": self.pipeline_phase,
            "outlineStatus": self.outline_status,
            "finalStatus": self.final_status,
        }

    def save(self, data_dir: Path) -> None:
        self.finalize()
        data_dir.mkdir(parents=True, exist_ok=True)
        trace_path(data_dir).write_text(
            json.dumps(self.to_state(), ensure_ascii=False),
            encoding="utf-8",
        )


def load_generation_trace(data_dir: Path) -> dict[str, Any] | None:
    path = trace_path(data_dir)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(raw, dict):
        return None
    return raw


def delete_generation_trace(data_dir: Path) -> None:
    path = trace_path(data_dir)
    if path.exists():
        path.unlink()
