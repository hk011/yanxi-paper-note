"""OpenAI 兼容 Chat Completions API（流式 + 工具循环）"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.prompts.image_gen import GEN_FIGURE_TOOL_DESC
from app.schemas.events import StreamEvent
from app.services.model_registry import ModelEndpoint, normalize_openai_base_url

GEN_FIGURE_OPENAI_TOOL = {
    "type": "function",
    "function": {
        "name": "gen_figure",
        "description": GEN_FIGURE_TOOL_DESC,
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Seedream 结构化中文提示"},
                "ref_image_path": {
                    "type": "string",
                    "description": "论文相关原图路径（images/xxx.jpg）",
                },
            },
            "required": ["prompt"],
        },
    },
}


def _chat_url(api_url: str) -> str:
    base = normalize_openai_base_url(api_url)
    return f"{base.rstrip('/')}/chat/completions"


def _to_openai_messages(input_messages: list[dict]) -> list[dict]:
    result: list[dict] = []
    for msg in input_messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            parts: list[dict] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = part.get("type", "")
                if ptype in ("input_text", "text"):
                    parts.append({"type": "text", "text": part.get("text", "")})
                elif ptype in ("input_image", "image_url"):
                    url = part.get("image_url") or part.get("url") or ""
                    if isinstance(url, dict):
                        url = url.get("url", "")
                    parts.append({"type": "image_url", "image_url": {"url": url}})
            out: dict[str, Any] = {"role": role, "content": parts or ""}
        else:
            out = {"role": role, "content": content}
        for key in ("reasoning_content", "tool_calls", "tool_call_id", "name"):
            if key in msg and msg[key] is not None:
                out[key] = msg[key]
        result.append(out)
    return result


def _allowed_tool_names(openai_tools: list[dict]) -> set[str]:
    names: set[str] = set()
    for tool in openai_tools:
        fn = tool.get("function") or {}
        if fn.get("name"):
            names.add(str(fn["name"]))
    return names


def _openai_tools(tools: list[dict] | None) -> list[dict]:
    if not tools:
        return []
    mapped: list[dict] = []
    for tool in tools:
        if tool.get("type") == "web_search":
            continue
        if tool.get("type") == "function" and tool.get("name") == "gen_figure":
            mapped.append(GEN_FIGURE_OPENAI_TOOL)
        elif tool.get("type") == "function" and tool.get("function"):
            mapped.append(tool)
        elif tool.get("type") == "function":
            mapped.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.get("name", ""),
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
                    },
                }
            )
    return mapped


def _delta_text(delta: dict) -> str:
    content = delta.get("content")
    if isinstance(content, str) and content:
        return content
    return ""


def _delta_reasoning(delta: dict) -> str:
    reasoning = delta.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning:
        return reasoning
    return ""


async def _raise_api_error(resp: httpx.Response) -> None:
    body = (await resp.aread()).decode("utf-8", errors="replace")
    detail = body[:500] if body else resp.reason_phrase
    raise httpx.HTTPStatusError(
        f"OpenAI API {resp.status_code}: {detail}",
        request=resp.request,
        response=resp,
    )


async def complete_text(
    *,
    endpoint: ModelEndpoint,
    input_messages: list[dict],
    timeout: float = 60.0,
) -> str:
    url = _chat_url(endpoint.api_url)
    headers = {
        "Authorization": f"Bearer {endpoint.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": endpoint.model,
        "messages": _to_openai_messages(input_messages),
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.is_error:
            await _raise_api_error(resp)
        data = resp.json()
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    text = message.get("content") or message.get("reasoning_content") or ""
    return str(text).strip()


async def _stream_chat_round(
    *,
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    on_content: Callable[[str], Awaitable[None]] | None,
    emit: Callable[[StreamEvent], Awaitable[None]],
    emit_content: bool,
) -> tuple[str, str, dict[int, dict]]:
    round_content: list[str] = []
    round_reasoning: list[str] = []
    tool_calls: dict[int, dict] = {}

    for attempt in range(3):
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            if resp.is_error:
                if resp.status_code in (429, 400, 503) and attempt < 2:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                await _raise_api_error(resp)

            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                usage = chunk.get("usage")
                if isinstance(usage, dict):
                    await emit(StreamEvent(type="usage", data=usage))

                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    text = _delta_text(delta)
                    if text:
                        round_content.append(text)
                        if on_content:
                            await on_content(text)
                        if emit_content:
                            await emit(
                                StreamEvent(type="content", data={"delta": text})
                            )
                    reasoning = _delta_reasoning(delta)
                    if reasoning:
                        round_reasoning.append(reasoning)
                        await emit(
                            StreamEvent(type="thinking", data={"delta": reasoning})
                        )

                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        entry = tool_calls.setdefault(
                            idx,
                            {"id": "", "name": "", "arguments": ""},
                        )
                        if tc.get("id"):
                            entry["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            entry["name"] = fn["name"]
                        if fn.get("arguments"):
                            entry["arguments"] += fn["arguments"]
            break

    return "".join(round_content), "".join(round_reasoning), tool_calls


async def run_with_tool_loop(
    *,
    endpoint: ModelEndpoint,
    input_messages: list[dict],
    tools: list[dict] | None = None,
    tool_handler: Callable[[str, dict], Awaitable[str]],
    on_content: Callable[[str], Awaitable[None]] | None = None,
    emit: Callable[[StreamEvent], Awaitable[None]],
    emit_content: bool = True,
) -> str:
    messages = _to_openai_messages(input_messages)
    openai_tools = _openai_tools(tools)
    allowed_tool_names = _allowed_tool_names(openai_tools)
    all_content: list[str] = []

    url = _chat_url(endpoint.api_url)
    headers = {
        "Authorization": f"Bearer {endpoint.api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=600.0) as client:
        for _round in range(8):
            body: dict[str, Any] = {
                "model": endpoint.model,
                "messages": messages,
                "stream": True,
            }
            if openai_tools:
                body["tools"] = openai_tools

            round_content, round_reasoning, tool_calls = await _stream_chat_round(
                client=client,
                url=url,
                headers=headers,
                body=body,
                on_content=on_content,
                emit=emit,
                emit_content=emit_content,
            )
            all_content.append(round_content or round_reasoning)

            if not tool_calls:
                break

            assistant_tool_calls = []
            for idx in sorted(tool_calls):
                info = tool_calls[idx]
                call_id = info.get("id") or f"call_{idx}"
                assistant_tool_calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": info.get("name") or "gen_figure",
                            "arguments": info.get("arguments") or "{}",
                        },
                    }
                )

            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": round_content or None,
                "tool_calls": assistant_tool_calls,
            }
            if round_reasoning:
                assistant_msg["reasoning_content"] = round_reasoning
            messages.append(assistant_msg)

            for idx in sorted(tool_calls):
                info = tool_calls[idx]
                name = info.get("name") or "gen_figure"
                call_id = info.get("id") or f"call_{idx}"
                raw_args = info.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    args = {"prompt": raw_args}

                tool_allowed = bool(allowed_tool_names) and name in allowed_tool_names
                if tool_allowed:
                    await emit(
                        StreamEvent(
                            type="tool_start",
                            data={"call_id": call_id, "tool": name, "input": args},
                        )
                    )
                try:
                    output = (
                        await tool_handler(name, args)
                        if tool_allowed
                        else json.dumps(
                            {"message": "该工具当前不可用，请勿重复调用"},
                            ensure_ascii=False,
                        )
                    )
                    status = "success"
                except Exception as e:
                    output = json.dumps({"error": str(e)}, ensure_ascii=False)
                    status = "error"
                if tool_allowed:
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
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": output,
                    }
                )

    return "".join(all_content)
