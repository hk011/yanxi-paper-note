import uuid
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlmodel import Session

from app.core.auth import decode_token, get_current_user, security
from app.core.config import get_settings
from app.db.models import User
from app.db.session import get_session
from app.schemas.user import UserProfileOut, UserProfileUpdate
from app.services.user_account import user_display_name

router = APIRouter(prefix="/api/users", tags=["users"])

_AVATAR_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_MAX_AVATAR_BYTES = 8 * 1024 * 1024


def user_profile_dir(user_id: int) -> Path:
    settings = get_settings()
    path = settings.data_dir / str(user_id) / "profile"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _profile_out(user: User) -> UserProfileOut:
    avatar_url = "/api/users/me/avatar" if user.avatar_path else None
    return UserProfileOut(
        id=user.id,
        username=user.username,
        display_name=user_display_name(user),
        account_code=user.account_code,
        avatar_url=avatar_url,
        created_at=user.created_at.isoformat(),
    )


@router.get("/me", response_model=UserProfileOut)
def get_me(user: Annotated[User, Depends(get_current_user)]):
    return _profile_out(user)


@router.patch("/me", response_model=UserProfileOut)
def update_me(
    body: UserProfileUpdate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    user.display_name = body.display_name.strip()
    session.add(user)
    session.commit()
    session.refresh(user)
    return _profile_out(user)


@router.post("/me/avatar", response_model=UserProfileOut)
async def upload_avatar(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    file: UploadFile = File(...),
):
    if not file.filename:
        raise HTTPException(400, "无效文件")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _AVATAR_SUFFIXES:
        raise HTTPException(400, "仅支持 JPG/PNG/GIF/WebP 图片")

    content = await file.read()
    if len(content) > _MAX_AVATAR_BYTES:
        raise HTTPException(400, "图片不能超过 8MB")

    profile_dir = user_profile_dir(user.id)
    for old in profile_dir.glob("avatar.*"):
        old.unlink(missing_ok=True)

    name = f"avatar{suffix}"
    dest = profile_dir / name
    async with aiofiles.open(dest, "wb") as out:
        await out.write(content)

    user.avatar_path = f"profile/{name}"
    session.add(user)
    session.commit()
    session.refresh(user)
    return _profile_out(user)


@router.get("/me/avatar")
def get_avatar(
    session: Annotated[Session, Depends(get_session)],
    token: str | None = None,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
):
    raw_token = creds.credentials if creds else token
    if not raw_token:
        raise HTTPException(401, "请先登录")
    payload = decode_token(raw_token)
    user = session.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(401, "用户不存在")
    if not user.avatar_path:
        raise HTTPException(404, "未设置头像")
    settings = get_settings()
    path = (settings.data_dir / str(user.id) / user.avatar_path).resolve()
    data_root = (settings.data_dir / str(user.id)).resolve()
    if not str(path).startswith(str(data_root)) or not path.is_file():
        raise HTTPException(404, "头像不存在")
    media = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    return FileResponse(path, media_type=media.get(path.suffix.lower(), "image/jpeg"))
