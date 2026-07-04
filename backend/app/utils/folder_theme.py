"""与前端 folderColor.ts 对齐的文件夹配色（供封面 prompt 使用）"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session, select

from app.db.models import Folder, PaperFolder

FOLDER_FAMILY_COUNT = 10
DEPTH_LEVELS = 4

# (from, to, accent) — 与 frontend COLOR_FAMILIES 一致
_COLOR_FAMILIES: list[list[tuple[str, str, str]]] = [
    [("#ede9fe", "#ddd6fe", "#4338ca"), ("#e0e7ff", "#c7d2fe", "#3730a3"), ("#c7d2fe", "#a5b4fc", "#312e81"), ("#a5b4fc", "#818cf8", "#1e1b4b")],
    [("#dbeafe", "#bfdbfe", "#1d4ed8"), ("#bfdbfe", "#93c5fd", "#1e40af"), ("#93c5fd", "#60a5fa", "#1e3a8a"), ("#60a5fa", "#3b82f6", "#172554")],
    [("#cffafe", "#a5f3fc", "#0e7490"), ("#a5f3fc", "#67e8f9", "#155e75"), ("#67e8f9", "#22d3ee", "#164e63"), ("#22d3ee", "#06b6d4", "#083344")],
    [("#dcfce7", "#bbf7d0", "#15803d"), ("#bbf7d0", "#86efac", "#166534"), ("#86efac", "#4ade80", "#14532d"), ("#4ade80", "#22c55e", "#052e16")],
    [("#fef3c7", "#fde68a", "#b45309"), ("#fde68a", "#fcd34d", "#92400e"), ("#fcd34d", "#fbbf24", "#78350f"), ("#fbbf24", "#f59e0b", "#451a03")],
    [("#fce7f3", "#fbcfe8", "#be185d"), ("#fbcfe8", "#f9a8d4", "#9d174d"), ("#f9a8d4", "#f472b6", "#831843"), ("#f472b6", "#ec4899", "#500724")],
    [("#fee2e2", "#fecaca", "#b91c1c"), ("#fecaca", "#fca5a5", "#991b1b"), ("#fca5a5", "#f87171", "#7f1d1d"), ("#f87171", "#ef4444", "#450a0a")],
    [("#f3e8ff", "#e9d5ff", "#6d28d9"), ("#e9d5ff", "#d8b4fe", "#5b21b6"), ("#d8b4fe", "#c084fc", "#4c1d95"), ("#c084fc", "#a855f7", "#3b0764")],
    [("#ffedd5", "#fed7aa", "#c2410c"), ("#fed7aa", "#fdba74", "#9a3412"), ("#fdba74", "#fb923c", "#7c2d12"), ("#fb923c", "#f97316", "#431407")],
    [("#ecfccb", "#d9f99d", "#4d7c0f"), ("#d9f99d", "#bef264", "#3f6212"), ("#bef264", "#a3e635", "#365314"), ("#a3e635", "#84cc16", "#1a2e05")],
]
_UNCATEGORIZED = ("#f9fafb", "#f3f4f6", "#4b5563")


@dataclass(frozen=True)
class FolderTheme:
    from_color: str
    to_color: str
    accent: str


def _theme_for_folder(folder_id: int, folders: list[Folder]) -> FolderTheme:
    by_id = {f.id: f for f in folders}
    folder = by_id.get(folder_id)
    if not folder:
        f, t, a = _UNCATEGORIZED
        return FolderTheme(f, t, a)

    roots = [f for f in folders if not f.parent_id]
    roots.sort(key=lambda x: (x.sort_order, x.id))
    root_index = 0
    for i, root in enumerate(roots):
        if root.id == folder_id:
            root_index = i
            break
    else:
        current = folder
        seen: set[int] = set()
        while current.parent_id and current.parent_id not in seen:
            seen.add(current.id)
            parent = by_id.get(current.parent_id)
            if not parent:
                break
            current = parent
        for i, root in enumerate(roots):
            if root.id == current.id:
                root_index = i
                break

    depth = 0
    current = folder
    seen = set()
    while current.parent_id and current.parent_id not in seen:
        seen.add(current.id)
        depth += 1
        parent = by_id.get(current.parent_id)
        if not parent:
            break
        current = parent

    family = _COLOR_FAMILIES[root_index % FOLDER_FAMILY_COUNT]
    level = min(depth, DEPTH_LEVELS - 1)
    f, t, a = family[level]
    return FolderTheme(f, t, a)


def get_paper_cover_palette(
    session: Session,
    user_id: int,
    paper_id: int,
    *,
    folder_id: int | None = None,
) -> str:
    if folder_id is None:
        folder_id = session.exec(
            select(PaperFolder.folder_id)
            .join(Folder, Folder.id == PaperFolder.folder_id)
            .where(PaperFolder.paper_id == paper_id)
            .order_by(PaperFolder.sort_order, Folder.id)
        ).first()
    if folder_id is None:
        f, t, a = _UNCATEGORIZED
        return f"soft neutral gradient {f} to {t}, accent {a}"

    folders = session.exec(select(Folder).where(Folder.user_id == user_id)).all()
    theme = _theme_for_folder(folder_id, list(folders))
    return (
        f"soft gradient {theme.from_color} to {theme.to_color}, "
        f"accent {theme.accent}"
    )
