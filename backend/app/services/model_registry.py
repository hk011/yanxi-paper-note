"""内置与用户自定义模型的解析与列表"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from sqlmodel import Session, select

from app.core.config import get_settings
from app.db.models import UserModel

CUSTOM_PREFIX = "custom:"


def normalize_openai_base_url(api_url: str) -> str:
    """规范 OpenAI 兼容 Base URL，确保落到 /v1/chat/completions。"""
    raw = (api_url or "").strip().rstrip("/")
    if not raw:
        return raw
    if raw.endswith("/chat/completions"):
        return raw[: -len("/chat/completions")].rstrip("/")
    parsed = urlparse(raw)
    path = parsed.path.rstrip("/")
    if path.endswith("/v1"):
        return raw
    if path in ("", "/"):
        return f"{raw}/v1"
    return raw


@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str
    source: str  # builtin | custom
    provider: str  # ark | openai


@dataclass(frozen=True)
class ModelEndpoint:
    key: str
    label: str
    provider: str
    model: str
    api_url: str
    api_key: str


def custom_model_key(model_id: int) -> str:
    return f"{CUSTOM_PREFIX}{model_id}"


def list_model_options(session: Session, user_id: int) -> list[ModelOption]:
    settings = get_settings()
    options: list[ModelOption] = []
    for model_id in settings.model_list or ["doubao-seed-2-0-pro-260215"]:
        options.append(
            ModelOption(
                id=model_id,
                label=model_id,
                source="builtin",
                provider="ark",
            )
        )
    custom_models = session.exec(
        select(UserModel)
        .where(UserModel.user_id == user_id)
        .order_by(UserModel.created_at.asc())
    ).all()
    for item in custom_models:
        options.append(
            ModelOption(
                id=custom_model_key(item.id),
                label=item.name,
                source="custom",
                provider="openai",
            )
        )
    return options


def default_model_key(session: Session, user_id: int) -> str:
    options = list_model_options(session, user_id)
    return options[0].id if options else "doubao-seed-2-0-pro-260215"


def resolve_model(session: Session, user_id: int, model_key: str) -> ModelEndpoint:
    settings = get_settings()
    key = (model_key or "").strip()
    if not key:
        key = default_model_key(session, user_id)

    if key.startswith(CUSTOM_PREFIX):
        raw_id = key[len(CUSTOM_PREFIX) :]
        if not raw_id.isdigit():
            raise ValueError("无效的自定义模型 ID")
        item = session.get(UserModel, int(raw_id))
        if not item or item.user_id != user_id:
            raise ValueError("自定义模型不存在")
        return ModelEndpoint(
            key=key,
            label=item.name,
            provider="openai",
            model=item.name,
            api_url=normalize_openai_base_url(item.api_url),
            api_key=item.api_key,
        )

    builtin = settings.model_list or ["doubao-seed-2-0-pro-260215"]
    if key not in builtin:
        raise ValueError(f"模型不可用: {key}")

    return ModelEndpoint(
        key=key,
        label=key,
        provider="ark",
        model=key,
        api_url=settings.ark_url.rstrip("/"),
        api_key=settings.ark_key,
    )


def model_label(session: Session, user_id: int, stored_model: str) -> str:
    key = (stored_model or "").strip()
    if not key:
        return ""
    if key.startswith(CUSTOM_PREFIX):
        try:
            return resolve_model(session, user_id, key).label
        except ValueError:
            return key
    return key
