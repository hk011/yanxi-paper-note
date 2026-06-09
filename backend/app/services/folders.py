from sqlmodel import Session, select

from app.db.models import Folder, Paper, PaperFolder
from app.schemas.folder import FolderOut


def _paper_counts(session: Session, user_id: int) -> dict[int, int]:
    rows = session.exec(
        select(PaperFolder.folder_id, PaperFolder.paper_id)
        .join(Paper, Paper.id == PaperFolder.paper_id)
        .where(Paper.user_id == user_id)
    ).all()
    counts: dict[int, int] = {}
    for folder_id, _ in rows:
        counts[folder_id] = counts.get(folder_id, 0) + 1
    return counts


def build_folder_tree(session: Session, user_id: int) -> list[FolderOut]:
    folders = session.exec(
        select(Folder).where(Folder.user_id == user_id).order_by(Folder.sort_order, Folder.id)
    ).all()
    counts = _paper_counts(session, user_id)
    nodes: dict[int, FolderOut] = {}
    for f in folders:
        nodes[f.id] = FolderOut(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            paper_count=counts.get(f.id, 0),
            children=[],
            created_at=f.created_at,
        )
    roots: list[FolderOut] = []
    for f in folders:
        node = nodes[f.id]
        if f.parent_id and f.parent_id in nodes:
            nodes[f.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


def get_folder_or_404(session: Session, user_id: int, folder_id: int) -> Folder:
    folder = session.get(Folder, folder_id)
    if not folder or folder.user_id != user_id:
        from fastapi import HTTPException

        raise HTTPException(404, "文件夹不存在")
    return folder


def is_descendant(session: Session, folder_id: int, candidate_parent_id: int) -> bool:
    current = candidate_parent_id
    seen: set[int] = set()
    while current is not None:
        if current == folder_id:
            return True
        if current in seen:
            return False
        seen.add(current)
        folder = session.get(Folder, current)
        if not folder:
            return False
        current = folder.parent_id
    return False


def delete_folder_cascade(session: Session, folder_id: int) -> None:
    children = session.exec(select(Folder).where(Folder.parent_id == folder_id)).all()
    for child in children:
        delete_folder_cascade(session, child.id)
    for link in session.exec(select(PaperFolder).where(PaperFolder.folder_id == folder_id)).all():
        session.delete(link)
    folder = session.get(Folder, folder_id)
    if folder:
        session.delete(folder)


def get_paper_folder_ids(session: Session, paper_id: int) -> list[int]:
    return list(
        session.exec(
            select(PaperFolder.folder_id)
            .join(Folder, Folder.id == PaperFolder.folder_id)
            .where(PaperFolder.paper_id == paper_id)
            .order_by(Folder.id)
        ).all()
    )


def should_regenerate_card_on_folder_change(
    old_ids: list[int], new_ids: list[int]
) -> bool:
    """唯一文件夹归属变化时重生成卡片；新增第二个文件夹时不触发。"""
    old_sorted = sorted(set(old_ids))
    new_sorted = sorted(set(new_ids))
    if old_sorted == new_sorted:
        return False
    if len(old_sorted) >= 1 and len(new_sorted) > len(old_sorted):
        return False
    if len(new_sorted) != 1:
        return False
    if len(old_sorted) == 0:
        return True
    if len(old_sorted) == 1:
        return old_sorted[0] != new_sorted[0]
    return new_sorted[0] != old_sorted[0]


def sync_paper_folders(
    session: Session, user_id: int, paper_id: int, folder_ids: list[int]
) -> None:
    valid_ids: list[int] = []
    for fid in folder_ids:
        folder = session.get(Folder, fid)
        if folder and folder.user_id == user_id:
            valid_ids.append(fid)
    existing = session.exec(
        select(PaperFolder).where(PaperFolder.paper_id == paper_id)
    ).all()
    for link in existing:
        session.delete(link)
    for fid in valid_ids:
        session.add(PaperFolder(paper_id=paper_id, folder_id=fid))


def paper_folder_meta(
    session: Session, paper_ids: list[int]
) -> dict[int, tuple[list[int], list[str]]]:
    if not paper_ids:
        return {}
    rows = session.exec(
        select(PaperFolder.paper_id, PaperFolder.folder_id, Folder.name)
        .join(Folder, Folder.id == PaperFolder.folder_id)
        .where(PaperFolder.paper_id.in_(paper_ids))
        .order_by(Folder.id)
    ).all()
    result: dict[int, tuple[list[int], list[str]]] = {}
    for paper_id, folder_id, name in rows:
        ids, names = result.get(paper_id, ([], []))
        ids = [*ids, folder_id]
        names = [*names, name]
        result[paper_id] = (ids, names)
    return result
