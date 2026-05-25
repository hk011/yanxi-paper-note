"""小节配图：多模态 LLM 优化 Seedream 提示词"""

from __future__ import annotations

import logging
import re
import time
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.prompts.figure_optimizer import SECTION_FIGURE_OPTIMIZER_SYSTEM
from app.services.ark_client import complete_text
from app.services.multimodal_input import build_multimodal_user_content
from app.services.note_sections import (
    _IMAGE_MD_RE,
    is_gen_figure_path,
    normalize_figure_rel_path,
    resolve_paper_file_path,
)

logger = logging.getLogger(__name__)

_MAX_SECTION_IMAGES = 6
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def parse_seedream_prompt(raw: str) -> str:
    """从优化模型输出中提取文生图提示词。"""
    text = (raw or "").strip()
    if not text:
        return ""
    fence = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines and not lines[0].startswith("绘制"):
        for i, ln in enumerate(lines):
            if ln.startswith("绘制"):
                text = "\n".join(lines[i:])
                break
    return text.strip()


def list_section_image_paths(
    data_dir: Path,
    section_body: str,
    *,
    skip_gen: bool = True,
) -> list[Path]:
    seen: set[Path] = set()
    ordered: list[Path] = []
    for m in _IMAGE_MD_RE.finditer(section_body):
        rel = normalize_figure_rel_path(m.group(2))
        if skip_gen and is_gen_figure_path(rel):
            continue
        resolved = resolve_paper_file_path(data_dir, rel)
        if not resolved or resolved.suffix.lower() not in _IMAGE_SUFFIXES:
            continue
        key = resolved.resolve()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(resolved)
        if len(ordered) >= _MAX_SECTION_IMAGES:
            break
    return ordered


def _build_user_text(
    *,
    heading: str,
    section_body: str,
    user_instruction: str,
    image_paths: list[Path],
) -> str:
    req = (user_instruction or "").strip() or "（无额外要求，请根据本节内容与附图自行规划）"
    img_note = (
        f"本节正文中共引用 {len(image_paths)} 张图片，已按顺序附在上方作为视觉输入，请结合图文理解后再写提示词。"
        if image_paths
        else "本节正文未引用可解析的图片，请仅依据文字内容规划配图。"
    )
    body = (section_body or "").strip()
    if len(body) > 12000:
        body = body[:12000] + "\n…（正文已截断）"
    batch_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    return (
        f"【小节标题】\n{heading.strip()}\n\n"
        f"【用户需求】\n{req}\n\n"
        f"【说明】\n{img_note}\n"
        f"【本次任务ID】{batch_id}\n"
        "每次生成都是独立任务：请重新规划画面构图与视觉隐喻，勿照搬常见模板或与以往生成雷同。\n\n"
        f"【本节正文 Markdown】\n{body}"
    )


def _build_multimodal_user_content(
    *,
    heading: str,
    section_body: str,
    user_instruction: str,
    image_paths: list[Path],
) -> list[dict]:
    return build_multimodal_user_content(
        text=_build_user_text(
            heading=heading,
            section_body=section_body,
            user_instruction=user_instruction,
            image_paths=image_paths,
        ),
        image_paths=image_paths,
    )


async def optimize_section_figure_prompt(
    *,
    data_dir: Path,
    heading: str,
    section_body: str,
    user_instruction: str = "",
) -> str:
    """多模态优化：小节正文 + 附图 → Seedream 提示词。"""
    settings = get_settings()
    if not settings.ark_key:
        raise RuntimeError("未配置 ark_key，无法调用配图优化模型")

    image_paths = list_section_image_paths(data_dir, section_body)
    user_content = _build_multimodal_user_content(
        heading=heading,
        section_body=section_body,
        user_instruction=user_instruction,
        image_paths=image_paths,
    )
    messages = [
        {"role": "system", "content": SECTION_FIGURE_OPTIMIZER_SYSTEM},
        {"role": "user", "content": user_content},
    ]
    model = settings.ark_figure_optimizer_model
    raw = await complete_text(
        model=model,
        input_messages=messages,
        enable_thinking=False,
        timeout=180.0,
    )
    prompt = parse_seedream_prompt(raw)
    if not prompt:
        raise RuntimeError("配图优化模型未返回有效文生图提示词")
    return prompt
