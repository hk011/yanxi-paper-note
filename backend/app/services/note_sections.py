"""笔记章节解析、配图与删改"""

from __future__ import annotations

import re
from pathlib import Path

_IMAGE_MD_RE = re.compile(
    r"!\[([^\]]*)\]\(([^)]+)\)"
)


def _parse_heading(line: str) -> tuple[int, str] | None:
    m = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
    if not m:
        return None
    return len(m.group(1)), m.group(2).strip()


def _normalize_heading(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def normalize_figure_rel_path(raw: str) -> str:
    text = (raw or "").strip().replace("\\", "/")
    text = re.sub(r"^/api/papers/\d+/files/", "", text)
    text = text.lstrip("./")
    if text.startswith("/"):
        text = text.lstrip("/")
    return text


def is_gen_figure_path(rel: str) -> bool:
    clean = normalize_figure_rel_path(rel)
    return bool(
        re.match(r"^images/gen/gen_\d+\.png$", clean, re.I)
        or re.match(r"^assets/gen_\d+\.png$", clean, re.I)
    )


def count_image_refs(content: str, rel: str) -> int:
    target = normalize_figure_rel_path(rel)
    name = Path(target).name
    count = 0
    for m in _IMAGE_MD_RE.finditer(content):
        src = normalize_figure_rel_path(m.group(2))
        if src == target or Path(src).name == name:
            count += 1
    return count


def remove_one_image_markdown(content: str, rel: str) -> tuple[str, bool]:
    """移除第一处匹配的配图 markdown 行（含前后空行整理）。"""
    target = normalize_figure_rel_path(rel)
    name = Path(target).name
    lines = content.splitlines()
    remove_idx: int | None = None
    for i, line in enumerate(lines):
        for m in _IMAGE_MD_RE.finditer(line):
            src = normalize_figure_rel_path(m.group(2))
            if src == target or Path(src).name == name:
                remove_idx = i
                break
        if remove_idx is not None:
            break
    if remove_idx is None:
        return content, False

    new_lines = lines[:remove_idx] + lines[remove_idx + 1 :]
    while remove_idx < len(new_lines) and not new_lines[remove_idx].strip():
        new_lines.pop(remove_idx)
    return "\n".join(new_lines), True


def find_section_range(content: str, heading: str) -> tuple[int, int, str]:
    """返回 (start_line, end_line_exclusive, section_body)。"""
    target = _normalize_heading(heading)
    lines = content.splitlines()
    start: int | None = None
    start_level: int | None = None

    for i, line in enumerate(lines):
        parsed = _parse_heading(line)
        if not parsed:
            continue
        level, text = parsed
        norm = _normalize_heading(text)
        if start is None:
            if norm == target:
                start = i
                start_level = level
            continue
        if level <= start_level:
            body = "\n".join(lines[start + 1 : i]).strip()
            return start, i, body

    if start is not None and start_level is not None:
        body = "\n".join(lines[start + 1 :]).strip()
        return start, len(lines), body

    raise ValueError(f"未找到小节：{heading}")


def replace_section_body(content: str, heading: str, new_body: str) -> str:
    start, end, _ = find_section_range(content, heading)
    lines = content.splitlines()
    body_lines = new_body.strip().splitlines()
    prefix = lines[: start + 1]
    suffix = lines[end:]
    merged: list[str] = list(prefix)
    if body_lines:
        if merged and merged[-1].strip():
            merged.append("")
        merged.extend(body_lines)
    if suffix:
        if merged and merged[-1].strip() and suffix[0].strip():
            merged.append("")
        merged.extend(suffix)
    return "\n".join(merged)


def insert_figure_after_heading(
    content: str,
    heading: str,
    image_rel: str,
    *,
    alt: str = "本节配图",
) -> str:
    lines = content.splitlines()
    start, _, _ = find_section_range(content, heading)
    insert_lines = ["", f"![{alt}]({image_rel})", ""]
    new_lines = lines[: start + 1] + insert_lines + lines[start + 1 :]
    return "\n".join(new_lines)


def gen_images_dir(data_dir: Path) -> Path:
    path = data_dir / "images" / "gen"
    path.mkdir(parents=True, exist_ok=True)
    return path


def next_gen_image_rel(data_dir: Path) -> tuple[Path, str]:
    out_dir = gen_images_dir(data_dir)
    existing = sorted(out_dir.glob("gen_*.png"))
    legacy = sorted((data_dir / "assets").glob("gen_*.png")) if (data_dir / "assets").is_dir() else []
    idx = len(existing) + len(legacy) + 1
    filename = f"gen_{idx:03d}.png"
    return out_dir / filename, f"images/gen/{filename}"
