"""统一 LLM 调用入口：内置 Ark Responses API / 用户自定义 OpenAI 兼容 API"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.schemas.events import StreamEvent
from app.services import ark_client, openai_client
from app.services.model_registry import ModelEndpoint


async def complete_text(
    *,
    endpoint: ModelEndpoint,
    input_messages: list[dict],
    enable_thinking: bool = False,
    timeout: float = 60.0,
) -> str:
    if endpoint.provider == "openai":
        return await openai_client.complete_text(
            endpoint=endpoint,
            input_messages=input_messages,
            timeout=timeout,
        )
    return await ark_client.complete_text(
        model=endpoint.model,
        input_messages=input_messages,
        enable_thinking=enable_thinking,
        timeout=timeout,
        api_url=endpoint.api_url,
        api_key=endpoint.api_key,
    )


async def run_with_tool_loop(
    *,
    endpoint: ModelEndpoint,
    input_messages: list[dict],
    tools: list[dict] | None = None,
    tool_handler: Callable[[str, dict], Awaitable[str]],
    on_content: Callable[[str], Awaitable[None]] | None = None,
    emit: Callable[[StreamEvent], Awaitable[None]],
    emit_content: bool = True,
    enable_thinking: bool = True,
) -> str:
    if endpoint.provider == "openai":
        filtered_tools = [
            t for t in (tools or []) if t.get("type") != "web_search"
        ]
        return await openai_client.run_with_tool_loop(
            endpoint=endpoint,
            input_messages=input_messages,
            tools=filtered_tools,
            tool_handler=tool_handler,
            on_content=on_content,
            emit=emit,
            emit_content=emit_content,
        )
    return await ark_client.run_with_tool_loop(
        model=endpoint.model,
        input_messages=input_messages,
        tools=tools,
        tool_handler=tool_handler,
        on_content=on_content,
        emit=emit,
        emit_content=emit_content,
        enable_thinking=enable_thinking,
        api_url=endpoint.api_url,
        api_key=endpoint.api_key,
    )
