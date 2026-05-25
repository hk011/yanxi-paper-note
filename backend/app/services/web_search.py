"""千帆百度搜索：MCP（streamableHttp）优先，REST 兜底"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

BAIDU_WEB_SEARCH_REST = "https://qianfan.baidubce.com/v2/ai_search/web_search"

_mcp_tool_name: str | None = None


def web_search_configured() -> bool:
    s = get_settings()
    return bool((s.web_search_mcp_server_key or "").strip())


def _auth_headers() -> dict[str, str]:
    key = get_settings().web_search_mcp_server_key.strip()
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }


def _normalize_query(raw: object) -> str:
    text = str(raw or "").strip()
    if len(text) > 72:
        return text[:72]
    return text


def _refs_from_baidu_references(references: list[dict]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in references:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            continue
        out.append(
            {
                "url": url,
                "title": (item.get("title") or item.get("web_anchor") or url)[:200],
                "snippet": (item.get("content") or "")[:500],
            }
        )
    return out[:10]


def _format_llm_output(query: str, refs: list[dict[str, str]]) -> str:
    payload = {
        "query": query,
        "result_count": len(refs),
        "results": refs,
    }
    return json.dumps(payload, ensure_ascii=False)


async def _parse_mcp_response(resp: httpx.Response) -> dict[str, Any]:
    ctype = (resp.headers.get("content-type") or "").lower()
    if "text/event-stream" in ctype:
        last: dict[str, Any] = {}
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                last = json.loads(data)
            except json.JSONDecodeError:
                continue
        return last
    return resp.json()


async def _mcp_jsonrpc(
    method: str,
    params: dict | None = None,
    *,
    session_id: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    url = (settings.web_search_mcp_server or "").strip().rstrip("/")
    if not url:
        raise RuntimeError("未配置 web_search_mcp_server")
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params or {},
    }
    headers = _auth_headers()
    if session_id:
        headers["Mcp-Session-Id"] = session_id

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.is_error:
            text = (await resp.aread()).decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"MCP 请求失败 {resp.status_code}: {text}")
        data = await _parse_mcp_response(resp)
    if data.get("error"):
        err = data["error"]
        raise RuntimeError(
            err.get("message") if isinstance(err, dict) else str(err)
        )
    return data.get("result") or {}


async def _mcp_initialize() -> str | None:
    result = await _mcp_jsonrpc(
        "initialize",
        {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "yanxi", "version": "1.0"},
        },
    )
    return result.get("sessionId") or result.get("session_id")


async def _resolve_mcp_tool_name(session_id: str | None) -> str:
    global _mcp_tool_name
    if _mcp_tool_name:
        return _mcp_tool_name
    result = await _mcp_jsonrpc("tools/list", {}, session_id=session_id)
    tools = result.get("tools") or []
    for t in tools:
        if not isinstance(t, dict):
            continue
        name = (t.get("name") or "").strip()
        if name:
            _mcp_tool_name = name
            return name
    _mcp_tool_name = "web_search"
    return _mcp_tool_name


def _text_from_mcp_result(result: dict) -> str:
    content = result.get("content") or []
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    if parts:
        return "\n".join(parts).strip()
    return json.dumps(result, ensure_ascii=False)[:8000]


def _refs_from_mcp_text(text: str) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    try:
        data = json.loads(text)
        if isinstance(data, dict) and isinstance(data.get("references"), list):
            return _refs_from_baidu_references(data["references"])
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            for item in data["results"]:
                if isinstance(item, dict) and item.get("url"):
                    refs.append(
                        {
                            "url": item["url"],
                            "title": item.get("title", item["url"]),
                            "snippet": item.get("snippet", item.get("content", "")),
                        }
                    )
            return refs[:10]
    except json.JSONDecodeError:
        pass
    for url in re.findall(r"https?://[^\s\])\"']+", text):
        if url not in {r["url"] for r in refs}:
            refs.append({"url": url, "title": url, "snippet": ""})
        if len(refs) >= 10:
            break
    return refs


async def _search_via_mcp(query: str) -> tuple[str, list[dict[str, str]]]:
    session_id = await _mcp_initialize()
    tool_name = await _resolve_mcp_tool_name(session_id)
    result = await _mcp_jsonrpc(
        "tools/call",
        {
            "name": tool_name,
            "arguments": {"query": query, "messages": [{"role": "user", "content": query}]},
        },
        session_id=session_id,
    )
    text = _text_from_mcp_result(result)
    refs = _refs_from_mcp_text(text)
    if not refs:
        try:
            data = json.loads(text)
            refs = _refs_from_baidu_references(data.get("references") or [])
        except json.JSONDecodeError:
            pass
    if refs:
        return _format_llm_output(query, refs), refs
    return text or _format_llm_output(query, []), refs


async def _search_via_rest(query: str) -> tuple[str, list[dict[str, str]]]:
    body = {
        "messages": [{"role": "user", "content": query}],
        "search_source": "baidu_search_v2",
        "resource_type_filter": [{"type": "web", "top_k": 10}],
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            BAIDU_WEB_SEARCH_REST,
            headers=_auth_headers(),
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
    if data.get("code"):
        raise RuntimeError(data.get("message") or data.get("code"))
    refs = _refs_from_baidu_references(data.get("references") or [])
    return _format_llm_output(query, refs), refs


async def execute_web_search(args: dict) -> tuple[str, list[dict[str, str]]]:
    """执行联网搜索，返回 (tool_output_json_str, references_for_ui)。"""
    if not web_search_configured():
        raise RuntimeError("未配置 web_search_mcp_server_key，无法联网搜索")

    query = _normalize_query(
        args.get("query") or args.get("q") or args.get("content") or ""
    )
    if not query:
        raise ValueError("请提供搜索关键词 query")

    settings = get_settings()
    if (settings.web_search_mcp_server or "").strip():
        try:
            return await _search_via_mcp(query)
        except Exception as e:
            logger.warning("MCP 联网搜索失败，尝试 REST 兜底: %s", e)

    return await _search_via_rest(query)
