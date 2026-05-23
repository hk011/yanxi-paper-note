"""将 MinerU content_list 转为模型可读骨架"""

import json
import re
from pathlib import Path

_IMAGE_MD_RE = re.compile(r"!\[[^\]]*\]\((images/[^)]+)\)")


def load_content_list(paper_dir: Path) -> list | dict | None:
    for name in ("content_list.json",):
        p = paper_dir / name
        if p.exists():
            with p.open(encoding="utf-8") as f:
                return json.load(f)

    mineru = paper_dir / "mineru"
    if mineru.is_dir():
        candidates = sorted(mineru.glob("*_content_list.json"))
        if candidates:
            with candidates[0].open(encoding="utf-8") as f:
                return json.load(f)
        fallback = mineru / "content_list.json"
        if fallback.exists():
            with fallback.open(encoding="utf-8") as f:
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


def build_image_catalog(
    content_list: list | dict | None,
    parsed_md: str = "",
) -> list[dict]:
    """从 parsed.md 与 content_list 构建「路径 ↔ 说明」映射，按正文出现顺序排列。"""
    by_path: dict[str, dict] = {}

    def upsert(
        path: str,
        *,
        caption: str = "",
        kind: str = "figure",
        page: str | int = "",
        order: int | None = None,
    ) -> None:
        clean = path.replace("\\", "/").lstrip("/")
        if not clean.startswith("images/"):
            return
        entry = by_path.get(clean)
        if entry is None:
            entry = {
                "path": clean,
                "caption": "",
                "kind": kind,
                "page": page,
                "order": order if order is not None else 10_000_000,
            }
            by_path[clean] = entry
        if caption and (not entry["caption"] or len(caption) > len(entry["caption"])):
            entry["caption"] = caption.strip()
        if kind != "figure" or entry["kind"] == "figure":
            entry["kind"] = kind
        if page != "" and entry["page"] == "":
            entry["page"] = page
        if order is not None and entry["order"] >= 10_000_000:
            entry["order"] = order

    order = 0
    if parsed_md:
        lines = parsed_md.splitlines()
        for i, line in enumerate(lines):
            match = _IMAGE_MD_RE.search(line)
            if not match:
                continue
            path = match.group(1)
            order += 1
            caption = _caption_after_line(lines, i)
            upsert(path, caption=caption, order=order)

    cl_order = 0
    for block in _iter_content_blocks(content_list):
        btype = block.get("type", "")
        img_path = block.get("img_path") or block.get("image_path") or ""
        if not img_path:
            continue
        if btype not in ("image", "table", "figure", "chart"):
            continue
        cl_order += 1
        page = block.get("page_idx", block.get("page", ""))
        caption = _block_caption(block)
        kind = "table" if btype == "table" else "figure"
        if caption and re.search(r"chart|柱状|折线|bar|line plot", caption, re.I):
            kind = "chart"
        upsert(
            str(img_path),
            caption=caption,
            kind=kind,
            page=page,
            order=by_path.get(str(img_path).replace("\\", "/").lstrip("/"), {}).get(
                "order", cl_order + 100_000
            ),
        )

    catalog = sorted(by_path.values(), key=lambda e: (e["order"], e["path"]))
    return catalog


def format_image_catalog(catalog: list[dict], limit: int = 80) -> str:
    if not catalog:
        return "（无提取图片）"
    lines: list[str] = []
    for entry in catalog[:limit]:
        path = entry["path"]
        caption = entry.get("caption") or "（无图题）"
        kind = entry.get("kind") or "figure"
        page = entry.get("page", "")
        page_part = f" [p{page}]" if page != "" else ""
        kind_label = {"figure": "图", "table": "表", "chart": "图表"}.get(kind, "图")
        lines.append(
            f"- [{kind_label}]{page_part} {caption} → 引用：![]({path})"
        )
    if len(catalog) > limit:
        lines.append(f"- … 另有 {len(catalog) - limit} 张未列出，请优先使用上述已标注图片")
    return "\n".join(lines)


def _caption_after_line(lines: list[str], index: int) -> str:
    for j in range(index + 1, min(index + 4, len(lines))):
        text = lines[j].strip()
        if not text or text.startswith("!["):
            continue
        if text.startswith("#"):
            break
        return text
    return ""


def _block_caption(block: dict) -> str:
    for key in ("image_caption", "table_caption", "caption"):
        val = block.get(key)
        if isinstance(val, list):
            text = " ".join(str(x) for x in val if x).strip()
            if text:
                return text
        elif isinstance(val, str) and val.strip():
            return val.strip()
    text = _extract_text(block)
    if text and ("Figure" in text or "figure" in text or "Fig." in text):
        return text
    return ""


def _iter_content_blocks(content_list: list | dict | None):
    if not content_list:
        return
    items = content_list if isinstance(content_list, list) else []
    if isinstance(content_list, dict):
        items = content_list.get("pages") or content_list.get("content") or []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") in ("image", "table", "figure", "chart") and (
            item.get("img_path") or item.get("image_path")
        ):
            yield item
            continue
        blocks = item.get("para_blocks") or item.get("blocks")
        if isinstance(blocks, list):
            for block in blocks:
                if isinstance(block, dict):
                    yield block
        elif item.get("text") or item.get("lines"):
            yield item


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
