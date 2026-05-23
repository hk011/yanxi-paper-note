"""将 MinerU content_list 转为模型可读骨架"""

import json
from pathlib import Path


def load_content_list(paper_dir: Path) -> list | dict | None:
    for name in ("content_list.json",):
        p = paper_dir / name
        if p.exists():
            with p.open(encoding="utf-8") as f:
                return json.load(f)
    return None


def build_paper_skeleton(content_list: list | dict | None, parsed_md: str = "") -> str:
    if not content_list and parsed_md:
        return parsed_md[:12000]

    lines: list[str] = []
    items = content_list if isinstance(content_list, list) else []
    if isinstance(content_list, dict):
        items = content_list.get("pages") or content_list.get("content") or []

    for item in items:
        if not isinstance(item, dict):
            continue
        page = item.get("page_idx", item.get("page", ""))
        blocks = item.get("para_blocks") or item.get("blocks") or [item]
        if not isinstance(blocks, list):
            blocks = [blocks]
        for block in blocks:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            text = _extract_text(block)
            if text:
                prefix = f"[p{page}] " if page != "" else ""
                lines.append(f"{prefix}{btype}: {text[:2000]}")

    if not lines and parsed_md:
        return parsed_md[:12000]
    return "\n".join(lines[:500]) or parsed_md[:12000]


def list_mineru_images(mineru_dir: Path) -> list[str]:
    images_dir = mineru_dir / "images"
    if not images_dir.exists():
        for d in mineru_dir.rglob("images"):
            if d.is_dir():
                images_dir = d
                break
    if not images_dir.exists():
        return []
    result = []
    for p in sorted(images_dir.iterdir()):
        if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            rel = f"images/{p.name}"
            result.append(rel)
    return result


def _extract_text(block: dict) -> str:
    if block.get("text"):
        return str(block["text"]).strip()
    lines = block.get("lines") or []
    parts = []
    for line in lines:
        if isinstance(line, dict):
            spans = line.get("spans") or []
            for span in spans:
                if isinstance(span, dict) and span.get("content"):
                    parts.append(str(span["content"]))
                elif isinstance(span, str):
                    parts.append(span)
        elif isinstance(line, str):
            parts.append(line)
    return " ".join(parts).strip()
