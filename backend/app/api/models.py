from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.auth import get_current_user
from app.db.models import User, UserModel
from app.db.session import get_session
from app.schemas.model import (
    ModelListOut,
    ModelOptionOut,
    UserModelCreate,
    UserModelOut,
    UserModelUpdate,
)
from app.services.model_registry import (
    default_model_key,
    list_model_options,
    normalize_openai_base_url,
)

router = APIRouter(prefix="/api/models", tags=["models"])


def _mask_api_url(url: str) -> str:
    return url.rstrip("/")


@router.get("", response_model=ModelListOut)
def list_available_models(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    options = list_model_options(session, user.id)
    return ModelListOut(
        models=[
            ModelOptionOut(id=opt.id, label=opt.label, source=opt.source)
            for opt in options
        ],
        default_model=default_model_key(session, user.id),
    )


@router.get("/custom", response_model=list[UserModelOut])
def list_custom_models(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    items = session.exec(
        select(UserModel)
        .where(UserModel.user_id == user.id)
        .order_by(UserModel.created_at.asc())
    ).all()
    return [
        UserModelOut(
            id=item.id,
            name=item.name,
            api_url=_mask_api_url(item.api_url),
            created_at=item.created_at,
        )
        for item in items
    ]


@router.post("/custom", response_model=UserModelOut, status_code=201)
def create_custom_model(
    body: UserModelCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    name = body.name.strip()
    api_url = normalize_openai_base_url(body.api_url.strip())
    api_key = body.api_key.strip()
    if not name or not api_url or not api_key:
        raise HTTPException(400, "模型名、URL 和 Key 均不能为空")

    existing = session.exec(
        select(UserModel).where(UserModel.user_id == user.id, UserModel.name == name)
    ).first()
    if existing:
        raise HTTPException(400, "已存在同名模型")

    item = UserModel(user_id=user.id, name=name, api_url=api_url, api_key=api_key)
    session.add(item)
    session.commit()
    session.refresh(item)
    return UserModelOut(
        id=item.id,
        name=item.name,
        api_url=_mask_api_url(item.api_url),
        created_at=item.created_at,
    )


@router.patch("/custom/{model_id}", response_model=UserModelOut)
def update_custom_model(
    model_id: int,
    body: UserModelUpdate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    item = session.get(UserModel, model_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "模型不存在")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "模型名不能为空")
        dup = session.exec(
            select(UserModel).where(
                UserModel.user_id == user.id,
                UserModel.name == name,
                UserModel.id != model_id,
            )
        ).first()
        if dup:
            raise HTTPException(400, "已存在同名模型")
        item.name = name
    if body.api_url is not None:
        api_url = normalize_openai_base_url(body.api_url.strip())
        if not api_url:
            raise HTTPException(400, "URL 不能为空")
        item.api_url = api_url
    if body.api_key is not None:
        api_key = body.api_key.strip()
        if not api_key:
            raise HTTPException(400, "Key 不能为空")
        item.api_key = api_key

    session.add(item)
    session.commit()
    session.refresh(item)
    return UserModelOut(
        id=item.id,
        name=item.name,
        api_url=_mask_api_url(item.api_url),
        created_at=item.created_at,
    )


@router.delete("/custom/{model_id}", status_code=204)
def delete_custom_model(
    model_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
):
    item = session.get(UserModel, model_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "模型不存在")
    session.delete(item)
    session.commit()
