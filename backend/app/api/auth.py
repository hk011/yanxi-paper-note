from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.auth import create_access_token, get_current_user, hash_password, verify_password
from app.db.models import User
from app.db.session import get_session
from app.schemas.auth import AuthRequest, AuthResponse
from app.schemas.user import ChangePasswordRequest
from app.services.user_account import ensure_unique_account_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse)
def register(body: AuthRequest, session: Annotated[Session, Depends(get_session)]):
    existing = session.exec(select(User).where(User.username == body.username)).first()
    if existing:
        raise HTTPException(400, "用户名已存在")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.username,
        account_code=ensure_unique_account_code(session),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    token = create_access_token(user.id, user.username)
    return AuthResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        display_name=user.display_name,
        account_code=user.account_code,
        avatar_url="/api/users/me/avatar" if user.avatar_path else None,
    )


@router.post("/login", response_model=AuthResponse)
def login(body: AuthRequest, session: Annotated[Session, Depends(get_session)]):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    token = create_access_token(user.id, user.username)
    return AuthResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        account_code=user.account_code,
        avatar_url="/api/users/me/avatar" if user.avatar_path else None,
    )


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(400, "当前密码不正确")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}
