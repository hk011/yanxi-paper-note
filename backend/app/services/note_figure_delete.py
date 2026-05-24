"""删除笔记中的 AI 生成配图（markdown 引用 + 磁盘文件 + Asset 记录）"""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Asset
from app.db.session import get_engine
from app.services.mineru import paper_data_dir
from app.services.note_refine import apply_refined_note
from app.services.note_sections import (
    count_image_refs,
    is_gen_figure_path,
    normalize_figure_rel_path,
    remove_all_image_markdown,
    resolve_paper_file_path,
)


def _asset_matches_rel(asset: Asset, rel: str, data_dir: Path) -> bool:
    name = Path(rel).name
    ap = Path(asset.path)
    if ap.name == name:
        return True
    try:
        if ap.is_absolute() and ap.is_file():
            ar = ap.relative_to(data_dir.resolve()).as_posix()
            if ar == rel:
                return True
    except ValueError:
        pass
    normalized = normalize_figure_rel_path(asset.path)
    return normalized == rel or normalized.endswith(f"/{name}")


def delete_gen_figure_from_note(
    *,
    paper_id: int,
    user_id: int,
    image_path: str,
) -> dict:
    rel = normalize_figure_rel_path(image_path)
    if not is_gen_figure_path(rel):
        raise ValueError("只能删除 AI 生成的配图")

    data_dir = paper_data_dir(user_id, paper_id)
    note_path = data_dir / "note.md"
    if not note_path.exists():
        raise FileNotFoundError("解读笔记尚未生成")

    raw = note_path.read_text(encoding="utf-8")
    before_refs = count_image_refs(raw, rel)
    if before_refs == 0:
        raise ValueError("笔记中未找到该配图引用")

    merged, removed_lines = remove_all_image_markdown(raw, rel)
    if removed_lines == 0:
        raise ValueError("未能移除配图引用")

    remaining_refs = count_image_refs(merged, rel)
    file_deleted = False
    disk_path = resolve_paper_file_path(data_dir, rel)
    if remaining_refs == 0 and disk_path is not None and disk_path.is_file():
        disk_path.unlink()
        file_deleted = True

    engine = get_engine()
    with Session(engine) as session:
        if remaining_refs == 0:
            for asset in session.exec(
                select(Asset).where(
                    Asset.paper_id == paper_id,
                    Asset.kind == "ai_generated",
                )
            ).all():
                if _asset_matches_rel(asset, rel, data_dir):
                    session.delete(asset)
            session.commit()

    saved = apply_refined_note(
        paper_id=paper_id,
        user_id=user_id,
        content=merged,
        model="",
    )
    return {
        **saved,
        "image_path": rel,
        "file_deleted": file_deleted,
        "remaining_refs": remaining_refs,
        "removed_lines": removed_lines,
    }
