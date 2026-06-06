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


def _deepseek_builtin_label(model_id: str) -> str:
    lower = model_id.lower()
    if "flash" in lower:
        return "DeepSeek V4 Flash"
    if "pro" in lower:
        return "DeepSeek V4 Pro"
    return model_id


def _ark_builtin_label(model_id: str) -> str:
    lower = model_id.lower()
    if "lite" in lower:
        return "豆包 Seed 2.0 Lite"
    if "pro" in lower:
        return "豆包 Seed 2.0 Pro"
    return model_id


def _builtin_model_ids(settings) -> list[str]:
    ids: list[str] = []
    if settings.deepseek_enabled:
        ids.extend(settings.deepseek_model_list)
    ids.extend(settings.model_list or ["doubao-seed-2-0-pro-260215"])
    return ids


def list_model_options(session: Session, user_id: int) -> list[ModelOption]:
    settings = get_settings()
    options: list[ModelOption] = []
    if settings.deepseek_enabled:
        for model_id in settings.deepseek_model_list:
            options.append(
                ModelOption(
                    id=model_id,
                    label=_deepseek_builtin_label(model_id),
                    source="builtin",
                    provider="openai",
                )
            )
    for model_id in settings.model_list or ["doubao-seed-2-0-pro-260215"]:
        options.append(
            ModelOption(
                id=model_id,
                label=_ark_builtin_label(model_id),
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

    if settings.deepseek_enabled and key in settings.deepseek_model_list:
        return ModelEndpoint(
            key=key,
            label=_deepseek_builtin_label(key),
            provider="openai",
            model=key,
            api_url=normalize_openai_base_url(settings.deepseek_url),
            api_key=settings.deepseek_key,
        )

    builtin = _builtin_model_ids(settings)
    if key not in builtin:
        raise ValueError(f"模型不可用: {key}")

    return ModelEndpoint(
        key=key,
        label=_ark_builtin_label(key),
        provider="ark",
        model=key,
        api_url=settings.ark_url.rstrip("/"),
        api_key=settings.ark_key,
    )


def model_label(session: Session, user_id: int, stored_model: str) -> str:
    key = extract_llm_model_key(stored_model)
    if not key:
        return ""
    if key.startswith(CUSTOM_PREFIX):
        try:
            return resolve_model(session, user_id, key).label
        except ValueError:
            return key
    settings = get_settings()
    if settings.deepseek_enabled and key in settings.deepseek_model_list:
        return _deepseek_builtin_label(key)
    return _ark_builtin_label(key) if key in (settings.model_list or []) else key


# 笔记保存时写入的「操作标记」，不是 LLM 模型 id，不应展示为「由 xxx 生成」
_INTERNAL_NOTE_MODELS = frozenset(
    {
        "manual",
        "refine",
        "delete_figure",
        "section_figure",
        "unknown",
    }
)


def is_internal_note_model(model: str) -> bool:
    key = (model or "").strip()
    if not key:
        return True
    if key in _INTERNAL_NOTE_MODELS:
        return True
    if key.startswith("restore_v"):
        return True
    return False


def extract_llm_model_key(model: str) -> str:
    """从 note.model 取出可展示的 LLM 模型 id。"""
    key = (model or "").strip()
    if key.startswith("section_refine:"):
        key = key.split(":", 1)[1].strip()
    if is_internal_note_model(key):
        return ""
    return key


def resolve_note_model_on_save(
    new_model: str,
    existing_model: str,
    *,
    session: Session | None = None,
    paper_id: int | None = None,
) -> str:
    """保存笔记时：仅在新值为真实模型 id 时更新，否则保留原生成模型。"""
    resolved = extract_llm_model_key(new_model)
    if resolved:
        return resolved
    existing = extract_llm_model_key(existing_model)
    if existing:
        return existing
    if session is not None and paper_id is not None:
        from app.db.models import Note

        rows = session.exec(
            select(Note)
            .where(Note.paper_id == paper_id)
            .order_by(Note.version.desc())
        ).all()
        for row in rows:
            key = extract_llm_model_key(row.model)
            if key:
                return key
    return (existing_model or "").strip()


def paper_note_model_label(
    session: Session, user_id: int, paper_id: int, stored_model: str
) -> str:
    """笔记顶栏展示用：跳过内部操作标记，必要时从历史版本记录找回模型名。"""
    label = model_label(session, user_id, stored_model)
    if label:
        return label
    from app.db.models import Note

    rows = session.exec(
        select(Note).where(Note.paper_id == paper_id).order_by(Note.version.desc())
    ).all()
    for row in rows:
        key = extract_llm_model_key(row.model)
        if key:
            return model_label(session, user_id, key)
    return ""
