import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db.models import User
from app.db.session import get_session
from app.services.user_account import ensure_unique_account_code

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: int, username: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效或过期的登录凭证") from e


def _get_or_create_api_user(session: Session) -> User:
    settings = get_settings()
    username = (settings.yanxi_username or "qwenpaw").strip()
    user = session.exec(select(User).where(User.username == username)).first()
    if user:
        return user
    user = User(
        username=username,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        display_name="QwenPaw",
        account_code=ensure_unique_account_code(session),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _user_from_api_key(api_key: str, session: Session) -> User | None:
    settings = get_settings()
    expected = (settings.yanxi_api_key or "").strip()
    if not expected or not secrets.compare_digest(api_key, expected):
        return None
    return _get_or_create_api_user(session)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: Annotated[Session, Depends(get_session)],
    yanxi_api_key: Annotated[str | None, Header(alias="X-Yanxi-Api-Key")] = None,
) -> User:
    if yanxi_api_key:
        user = _user_from_api_key(yanxi_api_key.strip(), session)
        if user:
            return user
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的 API Key")

    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "请先登录")
    payload = decode_token(creds.credentials)
    user_id = int(payload["sub"])
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")
    return user
