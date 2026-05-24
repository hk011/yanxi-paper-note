"""Seedream 图像生成（gen_figure 工具后端实现）"""

import json
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.prompts.image_gen import enhance_figure_prompt


async def generate_figure(
    prompt: str,
    output_dir: Path,
    ref_image_path: str | None = None,
    *,
    filename: str | None = None,
    rel_path: str | None = None,
    size: str | None = None,
) -> dict:
    """调用 Seedream API 生成说明图，落盘并返回本地访问路径。"""
    settings = get_settings()
    output_dir.mkdir(parents=True, exist_ok=True)
    final_prompt = enhance_figure_prompt(prompt)

    body: dict = {
        "model": settings.ark_image_gen_model,
        "prompt": final_prompt,
        "size": size or "2560x1440",
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

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        img_resp = await client.get(image_url)
        img_resp.raise_for_status()
        content = img_resp.content

    if filename is None:
        idx = len(list(output_dir.glob("gen_*.png"))) + 1
        filename = f"gen_{idx:03d}.png"
    dest = output_dir / filename
    dest.write_bytes(content)

    rel = rel_path or f"assets/{filename}"
    return {
        "url": rel,
        "local_path": str(dest),
        "prompt": final_prompt,
        "remote_url": image_url,
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
        },
        ensure_ascii=False,
    )
