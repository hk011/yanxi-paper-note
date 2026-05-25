"""联网搜索工具：Ark 内置 web_search vs 千帆 MCP function"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable

from app.schemas.events import StreamEvent
from app.services.model_registry import ModelEndpoint
from app.services.web_search import execute_web_search, web_search_configured

logger = logging.getLogger(__name__)

# 自定义模型经千帆 MCP 联网：每个环节（大纲/分章/综合/一轮问答/一次润色）最多调用次数
CUSTOM_WEB_SEARCH_MAX_PER_STAGE = 2

WEB_SEARCH_FUNCTION_TOOL = {
    "type": "function",
    "name": "web_search",
    "description": (
        "根据用户问题搜索实时网页信息，返回标题、摘要与链接。"
        "需要补充背景、最新进展、外部资料或核实事实时调用。"
        "query 为搜索词，宜简短（不超过约 36 个汉字）。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词或问句",
            },
        },
        "required": ["query"],
    },
}

WEB_SEARCH_OPENAI_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": WEB_SEARCH_FUNCTION_TOOL["description"],
        "parameters": WEB_SEARCH_FUNCTION_TOOL["parameters"],
    },
}


def uses_native_ark_web_search(endpoint: ModelEndpoint) -> bool:
    return endpoint.provider == "ark"


def search_enabled_for_endpoint(endpoint: ModelEndpoint) -> bool:
    return uses_native_ark_web_search(endpoint) or web_search_configured()


def web_search_calls_limit_for_endpoint(endpoint: ModelEndpoint) -> int | None:
    """内置 Ark 走原生搜索；自定义 + 已配置 MCP 时按环节限次。"""
    if uses_native_ark_web_search(endpoint):
        return None
    if web_search_configured():
        return CUSTOM_WEB_SEARCH_MAX_PER_STAGE
    return None


def build_search_tools(
    endpoint: ModelEndpoint,
    *,
    enable_search: bool,
) -> list[dict]:
    if not enable_search:
        return []
    if uses_native_ark_web_search(endpoint):
        return [{"type": "web_search", "limit": 10}]
    if web_search_configured():
        limit = CUSTOM_WEB_SEARCH_MAX_PER_STAGE
        return [
            {
                **WEB_SEARCH_FUNCTION_TOOL,
                "description": (
                    WEB_SEARCH_FUNCTION_TOOL["description"]
                    + f" 每个环节最多调用 {limit} 次，请勿重复检索。"
                ),
            }
        ]
    return []


def _search_limit_message(limit: int, query: str) -> str:
    return json.dumps(
        {
            "error": "stage_search_limit",
            "message": (
                f"本环节联网搜索已达上限（{limit} 次），"
                "请基于已有信息继续，勿再调用 web_search。"
            ),
            "query": query,
            "result_count": 0,
            "results": [],
        },
        ensure_ascii=False,
    )


def wrap_tool_handler_with_web_search(
    base_handler: Callable[[str, dict], Awaitable[str]],
    *,
    emit: Callable[[StreamEvent], Awaitable[None]] | None = None,
    endpoint: ModelEndpoint | None = None,
    max_web_search_calls: int | None = None,
) -> Callable[[str, dict], Awaitable[str]]:
    limit = max_web_search_calls
    if limit is None and endpoint is not None:
        limit = web_search_calls_limit_for_endpoint(endpoint)

    search_count = 0

    async def handler(name: str, args: dict) -> str:
        nonlocal search_count
        if name in ("web_search", "search"):
            query = (args.get("query") or args.get("q") or "").strip()
            if limit is not None and search_count >= limit:
                logger.info(
                    "web_search 环节配额已满 limit=%s query=%r", limit, query
                )
                output = _search_limit_message(limit, query)
                if emit:
                    await emit(
                        StreamEvent(
                            type="tool_delta",
                            data={
                                "tool": "web_search",
                                "query": query,
                                "input": args,
                                "hits": [],
                                "limit_reached": True,
                            },
                        )
                    )
                return output

            search_count += 1
            output, refs = await execute_web_search(args)
            if emit:
                await emit(
                    StreamEvent(
                        type="tool_delta",
                        data={
                            "tool": "web_search",
                            "query": query,
                            "input": args,
                            "hits": refs,
                        },
                    )
                )
                if refs:
                    await emit(
                        StreamEvent(
                            type="references",
                            data={
                                "tool": "web_search",
                                "query": query,
                                "items": refs,
                            },
                        )
                    )
            return output
        return await base_handler(name, args)

    return handler
