"""笔记版本列表与读取"""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from app.db.models import Note
from app.services.mineru import paper_data_dir


def _read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"版本文件不存在: {path.name}")
    return path.read_text(encoding="utf-8")


def list_note_versions(session: Session, paper_id: int, user_id: int) -> list[dict]:
    data_dir = paper_data_dir(user_id, paper_id)
    rows = session.exec(
        select(Note)
        .where(Note.paper_id == paper_id)
        .order_by(Note.version.desc())
    ).all()
    if not rows:
        note_path = data_dir / "note.md"
        if note_path.exists():
            return [
                {
                    "version": 1,
                    "model": "unknown",
                    "created_at": None,
                    "is_current": True,
                }
            ]
        return []

    max_version = max(r.version for r in rows)
    items: list[dict] = []
    for row in rows:
        items.append(
            {
                "version": row.version,
                "model": row.model or "",
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "is_current": row.version == max_version,
            }
        )
    return items


def get_note_version_content(
    session: Session, paper_id: int, user_id: int, version: int
) -> str:
    data_dir = paper_data_dir(user_id, paper_id)
    rows = session.exec(
        select(Note)
        .where(Note.paper_id == paper_id)
        .order_by(Note.version.desc())
    ).all()
    if not rows:
        if version == 1:
            return _read_text(data_dir / "note.md")
        raise FileNotFoundError("笔记版本不存在")

    max_version = rows[0].version
    if version < 1 or version > max_version:
        raise FileNotFoundError("笔记版本不存在")

    if version == max_version:
        return _read_text(data_dir / "note.md")

    backup = data_dir / f"note_v{version}.md"
    if backup.exists():
        return _read_text(backup)

    if version == 1 and (data_dir / "note.md").exists():
        # 仅 v1、尚未产生备份文件的旧数据
        return _read_text(data_dir / "note.md")

    raise FileNotFoundError("笔记版本不存在")
