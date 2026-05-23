import secrets
import string

from sqlmodel import Session, select

from app.db.models import User

_ACCOUNT_ALPHABET = string.ascii_uppercase + string.digits


def generate_account_code() -> str:
    suffix = "".join(secrets.choice(_ACCOUNT_ALPHABET) for _ in range(8))
    return f"YX{suffix}"


def ensure_unique_account_code(session: Session) -> str:
    for _ in range(32):
        code = generate_account_code()
        existing = session.exec(select(User).where(User.account_code == code)).first()
        if not existing:
            return code
    raise RuntimeError("无法生成唯一账号 ID")


def user_display_name(user: User) -> str:
    name = (user.display_name or "").strip()
    return name if name else user.username
