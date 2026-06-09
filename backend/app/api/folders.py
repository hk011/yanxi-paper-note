from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.auth import get_current_user
from app.db.models import Folder, User
from app.db.session import get_session
from app.schemas.folder import FolderCreateBody, FolderOut, FolderUpdateBody
from app.services.folders import (
    build_folder_tree,
    delete_folder_cascade,
    get_folder_or_404,
    is_descendant,
)

router = APIRouter(prefix="/api/folders", tags=["folders"])


@router.get("", response_model=list[FolderOut])
def list_folders(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    return build_folder_tree(session, user.id)


@router.post("", response_model=FolderOut)
def create_folder(
    body: FolderCreateBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "文件夹名称不能为空")
    if body.parent_id is not None:
        get_folder_or_404(session, user.id, body.parent_id)
    existing = session.exec(
        select(Folder).where(
            Folder.user_id == user.id,
            Folder.parent_id == body.parent_id,
            Folder.name == name,
        )
    ).first()
    if existing:
        raise HTTPException(400, "同级文件夹名称已存在")
    folder = Folder(user_id=user.id, name=name, parent_id=body.parent_id)
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        paper_count=0,
        children=[],
        created_at=folder.created_at,
    )


@router.patch("/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: int,
    body: FolderUpdateBody,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    folder = get_folder_or_404(session, user.id, folder_id)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "文件夹名称不能为空")
        parent_id = body.parent_id if body.parent_id is not None else folder.parent_id
        existing = session.exec(
            select(Folder).where(
                Folder.user_id == user.id,
                Folder.parent_id == parent_id,
                Folder.name == name,
                Folder.id != folder_id,
            )
        ).first()
        if existing:
            raise HTTPException(400, "同级文件夹名称已存在")
        folder.name = name
    if body.parent_id is not None:
        if body.parent_id == folder_id:
            raise HTTPException(400, "不能将文件夹移动到自身")
        if body.parent_id != 0:
            parent = get_folder_or_404(session, user.id, body.parent_id)
            if is_descendant(session, folder_id, parent.id):
                raise HTTPException(400, "不能将文件夹移动到其子文件夹中")
            folder.parent_id = parent.id
        else:
            folder.parent_id = None
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        paper_count=0,
        children=[],
        created_at=folder.created_at,
    )


@router.delete("/{folder_id}", status_code=204)
def delete_folder(
    folder_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    get_folder_or_404(session, user.id, folder_id)
    delete_folder_cascade(session, folder_id)
    session.commit()
