"""文生图（gen_figure 工具后端实现）：豆包 Seedream / 商汤 Sensenova"""

import json
import logging
import random
import re
from pathlib import Path
from typing import Literal

import httpx

from app.core.config import get_settings
from app.prompts.image_gen import (
    NOTE_FIGURE_SIZE,
    SENSENOVA_FIGURE_SIZE,
    enhance_figure_prompt,
)

logger = logging.getLogger(__name__)

ImageModelId = Literal["ark", "sensenova"]


def resolve_image_model(model_id: str) -> ImageModelId:
    if model_id == "sensenova":
        settings = get_settings()
        if not settings.sensenova_api_key.strip():
            raise ValueError("Sensenova 文生图未配置 API Key")
        return "sensenova"
    return "ark"


def _next_gen_filename(output_dir: Path) -> str:
    """为 assets/ 等目录分配 gen 文件名（优先走论文 data_dir 单调序号）。"""
    if output_dir.name == "assets":
        from app.services.note_sections import allocate_gen_figure_filename

        return allocate_gen_figure_filename(output_dir.parent)
    if output_dir.name == "gen" and output_dir.parent.name == "images":
        from app.services.note_sections import allocate_gen_figure_filename

        return allocate_gen_figure_filename(output_dir.parent.parent)
    max_idx = 0
    for p in output_dir.glob("gen_*.png"):
        m = re.match(r"gen_(\d+)\.png", p.name, re.I)
        if m:
            max_idx = max(max_idx, int(m.group(1)))
    return f"gen_{max_idx + 1:03d}.png"


def list_image_model_options() -> list[dict]:
    settings = get_settings()
    options: list[dict] = [
        {
            "id": "ark",
            "label": "豆包 Seedream",
            "hint": "通用学术配图",
            "available": bool(settings.ark_key.strip()),
        },
        {
            "id": "sensenova",
            "label": "商汤 Nova",
            "hint": "更适合信息图",
            "available": bool(settings.sensenova_api_key.strip()),
        },
    ]
    return options


async def _download_image(image_url: str) -> bytes:
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        img_resp = await client.get(image_url)
        img_resp.raise_for_status()
        return img_resp.content


async def _generate_ark(
    prompt: str,
    *,
    size: str,
    ref_image_path: str | None,
) -> tuple[str, str]:
    settings = get_settings()
    body: dict = {
        "model": settings.ark_image_gen_model,
        "prompt": prompt,
        "size": size,
        "seed": random.randint(0, 2147483647),
        "response_format": "url",
        "watermark": False,
    }

    if ref_image_path:
        ref = Path(ref_image_path)
        if ref.exists():
            import base64

            b64 = base64.b64encode(ref.read_bytes()).decode()
            mime = "image/jpeg" if ref.suffix.lower() in (".jpg", ".jpeg") else "image/png"
            body["image"] = f"data:{mime};base64,{b64}"

    url = f"{settings.ark_url.rstrip('/')}/images/generations"
    headers = {
        "Authorization": f"Bearer {settings.ark_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    items = data.get("data") or []
    if not items:
        raise RuntimeError("图像生成未返回结果")

    image_url = items[0].get("url", "")
    if not image_url:
        raise RuntimeError("图像生成 URL 为空")
    logger.info(
        "文生图 ark model=%s size=%s remote=%s",
        settings.ark_image_gen_model,
        size,
        image_url[:120],
    )
    return image_url, "ark"


async def _generate_sensenova(
    prompt: str,
    *,
    size: str,
    ref_image_path: str | None,
) -> tuple[str, str]:
    if ref_image_path:
        logger.warning("Sensenova 不支持图生图参考，已忽略 ref_image_path")

    settings = get_settings()
    url = f"{settings.sensenova_api_url.rstrip('/')}/images/generations"
    headers = {
        "Authorization": f"Bearer {settings.sensenova_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.sensenova_model,
        "prompt": prompt,
        "size": size,
        "n": 1,
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    items = data.get("data") or []
    if not items:
        raise RuntimeError("图像生成未返回结果")

    image_url = items[0].get("url", "")
    if not image_url:
        raise RuntimeError("图像生成 URL 为空")
    logger.info(
        "文生图 sensenova model=%s size=%s remote=%s",
        settings.sensenova_model,
        size,
        image_url[:120],
    )
    return image_url, "sensenova"


async def generate_figure(
    prompt: str,
    output_dir: Path,
    ref_image_path: str | None = None,
    *,
    filename: str | None = None,
    rel_path: str | None = None,
    size: str | None = None,
    image_model: str = "ark",
) -> dict:
    """调用文生图 API 生成说明图，落盘并返回本地访问路径。"""
    provider = resolve_image_model(image_model)
    output_dir.mkdir(parents=True, exist_ok=True)
    final_prompt = enhance_figure_prompt(prompt)

    banner = "=" * 60
    print(f"\n{banner}", flush=True)
    print(
        f"[文生图] provider={provider} image_model={image_model}",
        flush=True,
    )
    if prompt.strip() != final_prompt.strip():
        print(f"[输入 prompt {len(prompt)} 字]\n{prompt}", flush=True)
        print(
            f"[最终 prompt {len(final_prompt)} 字]（enhance 后发给 API）\n{final_prompt}",
            flush=True,
        )
    else:
        print(
            f"[最终 prompt {len(final_prompt)} 字]\n{final_prompt}",
            flush=True,
        )
    print(f"{banner}\n", flush=True)
    logger.info(
        "文生图 prompt provider=%s image_model=%s raw_len=%d final_len=%d",
        provider,
        image_model,
        len(prompt),
        len(final_prompt),
    )

    figure_size = (
        SENSENOVA_FIGURE_SIZE if provider == "sensenova" else NOTE_FIGURE_SIZE
    )

    if provider == "sensenova":
        image_url, used_model = await _generate_sensenova(
            final_prompt, size=figure_size, ref_image_path=ref_image_path
        )
    else:
        image_url, used_model = await _generate_ark(
            final_prompt, size=figure_size, ref_image_path=ref_image_path
        )

    content = await _download_image(image_url)

    if filename is None:
        filename = _next_gen_filename(output_dir)
    dest = output_dir / filename
    dest.write_bytes(content)

    rel = rel_path or f"assets/{filename}"
    logger.info(
        "generate_figure done provider=%s dest=%s bytes=%d prompt_len=%d",
        used_model,
        dest,
        len(content),
        len(final_prompt),
    )
    return {
        "url": rel,
        "local_path": str(dest),
        "prompt": final_prompt,
        "remote_url": image_url,
        "image_model": used_model,
    }


def format_tool_output(result: dict, paper_id: int) -> str:
    rel = result["url"]
    api_path = f"/api/papers/{paper_id}/files/{rel}"
    return json.dumps(
        {
            "image_url": rel,
            "api_url": api_path,
            "markdown": f"![说明图]({rel})",
            "message": f"图片已生成，请在笔记 markdown 代码块内插入：![说明图]({rel})",
            "image_model": result.get("image_model", "ark"),
        },
        ensure_ascii=False,
    )
