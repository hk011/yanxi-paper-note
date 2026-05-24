"""火山方舟 Responses API 流式调用 + 事件映射 + 自定义工具循环"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Awaitable
from typing import Any

import httpx

from app.core.config import get_settings
from app.prompts.image_gen import GEN_FIGURE_TOOL_DESC
from app.schemas.events import StreamEvent

GEN_FIGURE_TOOL = {
    "type": "function",
    "name": "gen_figure",
    "description": GEN_FIGURE_TOOL_DESC,
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": (
                    "按模板组装的完整中文提示：图的类型+展示内容+布局+风格+引号内标签+参考知识。"
                    "勿超过约 300 汉字。"
                ),
            },
            "figure_kind": {
                "type": "string",
                "description": "可选，帮助系统选择宽高比",
                "enum": [
                    "infographic",
                    "architecture",
                    "flow",
                    "comparison",
                    "mechanism",
                    "roadmap",
                    "pipeline",
                    "timeline",
                    "equation_board",
                ],
            },
            "ref_image_path": {
                "type": "string",
                "description": "强烈建议：论文相关架构/流程原图的本地绝对路径，用于保持模块与命名一致",
            },
        },
        "required": ["prompt"],
    },
}

DEFAULT_TOOLS = [
    {"type": "web_search", "limit": 10},
    GEN_FIGURE_TOOL,
]


class ArkStreamState:
    def __init__(self) -> None:
        self.web_search_calls: dict[str, str] = {}
        self.last_web_search_call_id: str | None = None
        self.pending_function_calls: dict[str, dict] = {}
        self.response_id: str | None = None
        self.usage: dict[str, int] = {}


def _extract_search_refs(value: Any) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return

        url = (
            node.get("url")
            or node.get("link")
            or node.get("source_url")
            or node.get("uri")
        )
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            refs.append(
                {
                    "url": url,
                    "title": node.get("title") or node.get("name") or url,
                    "snippet": node.get("snippet")
                    or node.get("summary")
                    or node.get("content")
                    or "",
                }
            )

        annotation = node.get("url_citation") or node.get("citation")
        if isinstance(annotation, dict):
            walk(annotation)

        for child in node.values():
            if isinstance(child, (dict, list)):
                walk(child)

    walk(value)

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for ref in refs:
        url = ref.get("url", "")
        if url and url not in seen:
            seen.add(url)
            unique.append(ref)
    return unique


async def _parse_sse_lines(
    response: httpx.Response,
) -> AsyncIterator[dict[str, Any]]:
    async for line in response.aiter_lines():
        if not line or not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


def _map_chunk_to_events(chunk: dict, state: ArkStreamState) -> list[StreamEvent]:
    events: list[StreamEvent] = []
    ctype = chunk.get("type", "")

    if chunk.get("response") and chunk["response"].get("id"):
        state.response_id = chunk["response"]["id"]

    if ctype == "response.reasoning_summary_text.delta":
        delta = chunk.get("delta", "")
        if delta:
            events.append(StreamEvent(type="thinking", data={"delta": delta}))

    elif ctype == "response.web_search_call.in_progress":
        item = chunk.get("item") or {}
        call_id = item.get("id") or chunk.get("item_id", "")
        state.web_search_calls[call_id] = call_id
        state.last_web_search_call_id = call_id
        events.append(
            StreamEvent(
                type="tool_start",
                data={"tool": "web_search", "call_id": call_id, "input": {}},
            )
        )

    elif ctype == "response.web_search_call.completed":
        item = chunk.get("item") or {}
        call_id = item.get("id") or state.last_web_search_call_id or ""
        action = item.get("action") or {}
        query = action.get("query", "")
        refs = action.get("sources") or action.get("results") or []
        hits = _extract_search_refs({"action": action, **item}) if not refs else refs
        if not isinstance(hits, list):
            hits = _extract_search_refs(hits)
        hits = hits[:10]
        events.append(
            StreamEvent(
                type="tool_delta",
                data={
                    "tool": "web_search",
                    "call_id": call_id,
                    "query": query,
                    "input": {"query": query},
                    "hits": hits,
                },
            )
        )
        events.append(
            StreamEvent(
                type="tool_end",
                data={
                    "call_id": call_id,
                    "tool": "web_search",
                    "status": "success",
                    "query": query,
                    "hits": hits,
                    "output": item,
                },
            )
        )
        state.web_search_calls.pop(call_id, None)

    elif ctype == "response.output_item.done":
        item = chunk.get("item") or {}
        item_id = str(item.get("id", ""))
        if item_id.startswith("ws_"):
            action = item.get("action") or {}
            query = action.get("query", "")
            refs = action.get("sources") or action.get("results") or []
            hits = _extract_search_refs(item) if not refs else refs
            if not isinstance(hits, list):
                hits = _extract_search_refs(hits)
            hits = hits[:10]
            call_id = (
                next(iter(state.web_search_calls), None)
                or state.last_web_search_call_id
                or item_id
            )
            if hits:
                events.append(
                    StreamEvent(
                        type="tool_delta",
                        data={
                            "tool": "web_search",
                            "call_id": call_id,
                            "query": query,
                            "input": {"query": query},
                            "hits": hits,
                        },
                    )
                )
                events.append(
                    StreamEvent(
                        type="references",
                        data={
                            "tool": "web_search",
                            "call_id": call_id,
                            "query": query,
                            "items": hits[:10],
                        },
                    )
                )
            state.web_search_calls.pop(call_id, None)
        elif item.get("type") == "function_call":
            call_id = item.get("call_id") or item.get("id", "")
            name = item.get("name", "")
            args_raw = item.get("arguments", "{}")
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
            except json.JSONDecodeError:
                args = {"raw": args_raw}
            state.pending_function_calls[call_id] = {
                "name": name,
                "arguments": args,
                "call_id": call_id,
            }
            events.append(
                StreamEvent(
                    type="tool_start",
                    data={"tool": name, "call_id": call_id, "input": args},
                )
            )

    elif ctype == "response.output_text.delta":
        delta = chunk.get("delta", "")
        if delta:
            events.append(StreamEvent(type="content", data={"delta": delta}))

    elif ctype == "response.completed":
        resp = chunk.get("response") or {}
        state.response_id = resp.get("id") or state.response_id
        usage = resp.get("usage") or {}
        if usage:
            state.usage = {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            }
            events.append(StreamEvent(type="usage", data=state.usage))
        for item in resp.get("output") or []:
            if not isinstance(item, dict):
                continue
            refs = _extract_search_refs(item)
            if refs:
                call_id = state.last_web_search_call_id or next(
                    iter(state.web_search_calls), None
                )
                if call_id:
                    events.append(
                        StreamEvent(
                            type="tool_delta",
                            data={
                                "tool": "web_search",
                                "call_id": call_id,
                                "hits": refs[:10],
                            },
                        )
                    )
                    events.append(
                        StreamEvent(
                            type="references",
                            data={
                                "tool": "web_search",
                                "call_id": call_id,
                                "items": refs[:10],
                            },
                        )
                    )
            if item.get("type") == "function_call":
                call_id = item.get("call_id") or item.get("id", "")
                name = item.get("name", "")
                args_raw = item.get("arguments", "{}")
                try:
                    args = (
                        json.loads(args_raw) if isinstance(args_raw, str) else args_raw
                    )
                except json.JSONDecodeError:
                    args = {"raw": args_raw}
                state.pending_function_calls[call_id] = {
                    "name": name,
                    "arguments": args,
                    "call_id": call_id,
                }

    return events


def _extract_response_text(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            for block in item.get("content") or []:
                if not isinstance(block, dict):
                    continue
                text = block.get("text") or block.get("value") or ""
                if text:
                    parts.append(str(text))
        elif item.get("type") in ("output_text", "text"):
            text = item.get("text") or item.get("value") or ""
            if text:
                parts.append(str(text))
    return "".join(parts).strip()


async def complete_text(
    *,
    model: str,
    input_messages: list[dict],
    enable_thinking: bool = False,
    timeout: float = 60.0,
    api_url: str | None = None,
    api_key: str | None = None,
) -> str:
    """非流式 Responses 调用，返回完整文本。"""
    settings = get_settings()
    url = f"{(api_url or settings.ark_url).rstrip('/')}/responses"
    headers = {
        "Authorization": f"Bearer {api_key or settings.ark_key}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "model": model,
        "input": input_messages,
        "stream": False,
        "tools": [],
        "thinking": {"type": "enabled" if enable_thinking else "disabled"},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
    return _extract_response_text(data)


async def stream_response(
    *,
    model: str,
    input_messages: list[dict],
    tools: list[dict] | None = None,
    previous_response_id: str | None = None,
    on_content: Callable[[str], Awaitable[None]] | None = None,
    api_url: str | None = None,
    api_key: str | None = None,
) -> AsyncIterator[StreamEvent]:
    """单次 Responses 流式调用，返回完整文本与状态。"""
    settings = get_settings()
    url = f"{(api_url or settings.ark_url).rstrip('/')}/responses"
    headers = {
        "Authorization": f"Bearer {api_key or settings.ark_key}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "model": model,
        "input": input_messages,
        "stream": True,
        "tools": DEFAULT_TOOLS if tools is None else tools,
    }
    if previous_response_id:
        body["previous_response_id"] = previous_response_id

    state = ArkStreamState()
    full_text: list[str] = []

    async with httpx.AsyncClient(timeout=600.0) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for chunk in _parse_sse_lines(resp):
                for ev in _map_chunk_to_events(chunk, state):
                    if ev.type == "content" and on_content:
                        delta = ev.data.get("delta", "")
                        if delta:
                            full_text.append(delta)
                            await on_content(delta)
                    yield ev

    # This is an async generator; callers consume StreamEvent values from yield.


async def run_with_tool_loop(
    *,
    model: str,
    input_messages: list[dict],
    tools: list[dict] | None = None,
    tool_handler: Callable[[str, dict], Awaitable[str]],
    on_content: Callable[[str], Awaitable[None]] | None = None,
    emit: Callable[[StreamEvent], Awaitable[None]],
    emit_content: bool = True,
    enable_thinking: bool = True,
    api_url: str | None = None,
    api_key: str | None = None,
) -> str:
    """流式调用 + 自动执行 gen_figure 等自定义工具并续写。"""
    messages = list(input_messages)
    prev_id: str | None = None
    all_content: list[str] = []

    for _round in range(8):
        round_text: list[str] = []
        pending_calls: dict[str, dict] = {}

        settings = get_settings()
        url = f"{(api_url or settings.ark_url).rstrip('/')}/responses"
        headers = {
            "Authorization": f"Bearer {api_key or settings.ark_key}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any] = {
            "model": model,
            "input": messages,
            "stream": True,
            "tools": DEFAULT_TOOLS if tools is None else tools,
        }
        if prev_id:
            body["previous_response_id"] = prev_id
        body["thinking"] = {"type": "enabled" if enable_thinking else "disabled"}

        state = ArkStreamState()
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for chunk in _parse_sse_lines(resp):
                    for ev in _map_chunk_to_events(chunk, state):
                        if ev.type == "content":
                            d = ev.data.get("delta", "")
                            if d:
                                round_text.append(d)
                                all_content.append(d)
                                if on_content:
                                    await on_content(d)
                        if ev.type == "tool_start" and ev.data.get("tool") == "gen_figure":
                            pending_calls[ev.data.get("call_id", "")] = ev.data.get(
                                "input", {}
                            )
                        if emit_content or ev.type != "content":
                            await emit(ev)

        prev_id = state.response_id
        func_calls = {**state.pending_function_calls, **pending_calls}

        if not func_calls:
            break

        tool_outputs = []
        for call_id, info in func_calls.items():
            name = info.get("name", "gen_figure")
            args = info.get("arguments", info)
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"prompt": args}
            try:
                output = await tool_handler(name, args)
                status = "success"
            except Exception as e:
                output = json.dumps({"error": str(e)}, ensure_ascii=False)
                status = "error"
            await emit(
                StreamEvent(
                    type="tool_end",
                    data={
                        "call_id": call_id,
                        "tool": name,
                        "status": status,
                        "output": output,
                    },
                )
            )
            tool_outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                }
            )

        messages = tool_outputs

    return "".join(all_content)
