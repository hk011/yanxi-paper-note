"""多模态请求：本地图片路径 → Ark / OpenAI 兼容 content parts"""

from __future__ import annotations

import base64
from pathlib import Path

from app.services.model_registry import ModelEndpoint
from app.services.note_sections import resolve_paper_file_path

_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def model_supports_vision(endpoint: ModelEndpoint) -> bool:
    """内置 Ark 多模态模型支持识图；自定义 OpenAI 兼容模型仅文本。"""
    return endpoint.provider == "ark"


def image_path_to_input_part(path: Path) -> dict:
    suffix = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(suffix, "image/jpeg")
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "input_image",
        "image_url": f"data:{mime};base64,{b64}",
    }


def resolve_attachment_paths(
    data_dir: Path,
    attachments: list[dict] | None,
    *,
    max_count: int = 8,
) -> list[Path]:
    seen: set[Path] = set()
    ordered: list[Path] = []
    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        rel = (att.get("path") or att.get("url") or "").strip()
        if not rel:
            continue
        resolved = resolve_paper_file_path(data_dir, rel)
        if not resolved or resolved.suffix.lower() not in _IMAGE_SUFFIXES:
            continue
        key = resolved.resolve()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(resolved)
        if len(ordered) >= max_count:
            break
    return ordered


def build_multimodal_user_content(*, text: str, image_paths: list[Path]) -> list[dict]:
    parts: list[dict] = []
    for p in image_paths:
        parts.append(image_path_to_input_part(p))
    parts.append({"type": "input_text", "text": text})
    return parts
