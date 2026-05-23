from collections.abc import Generator

from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import get_settings
from app.db.models import User, UserModel
from app.services.user_account import ensure_unique_account_code

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        # SQLite 开发环境用 NullPool，避免 SSE 长连接占满默认连接池（5+10）
        _engine = create_engine(
            f"sqlite:///{settings.db_path}",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
    return _engine


def _migrate_db() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(paper)")}
        if "parse_started_at" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE paper ADD COLUMN parse_started_at DATETIME"
            )
            conn.commit()
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(paper)")}
        if "parse_finished_at" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE paper ADD COLUMN parse_finished_at DATETIME"
            )
            conn.commit()
        conv_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(conversation)")}
        if "kind" not in conv_cols:
            conn.exec_driver_sql(
                "ALTER TABLE conversation ADD COLUMN kind VARCHAR DEFAULT 'qa'"
            )
            conn.commit()
        conv_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(conversation)")}
        if "updated_at" not in conv_cols:
            conn.exec_driver_sql(
                "ALTER TABLE conversation ADD COLUMN updated_at DATETIME"
            )
            conn.exec_driver_sql(
                "UPDATE conversation SET updated_at = created_at WHERE updated_at IS NULL"
            )
            conn.commit()

        user_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user)")}
        if "display_name" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN display_name VARCHAR DEFAULT ''")
            conn.commit()
        user_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user)")}
        if "account_code" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN account_code VARCHAR DEFAULT ''")
            conn.commit()
        user_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user)")}
        if "avatar_path" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN avatar_path VARCHAR DEFAULT ''")
            conn.commit()


def _backfill_user_account_codes() -> None:
    with Session(get_engine()) as session:
        users = session.exec(select(User).where(User.account_code == "")).all()
        for user in users:
            user.account_code = ensure_unique_account_code(session)
            if not (user.display_name or "").strip():
                user.display_name = user.username
            session.add(user)
        if users:
            session.commit()


def init_db() -> None:
    SQLModel.metadata.create_all(get_engine())
    _migrate_db()
    _backfill_user_account_codes()


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session
