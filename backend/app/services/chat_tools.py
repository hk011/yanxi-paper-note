"""问答 / 笔记编辑共用的 gen_figure 工具执行"""

from __future__ import annotations

import json
from pathlib import Path

from sqlmodel import Session

from app.db.models import Asset
from app.db.session import get_engine
from app.services.mineru import paper_data_dir
from app.services.tools.image_gen import format_tool_output, generate_figure


def make_gen_figure_tool_handler(paper_id: int, user_id: int, image_model: str = "sensenova"):
    data_dir = paper_data_dir(user_id, paper_id)
    assets_dir = data_dir / "assets"
    mineru_dir = data_dir

    async def handler(name: str, args: dict) -> str:
        if name != "gen_figure":
            return json.dumps(
                {"error": f"不支持的工具: {name}"}, ensure_ascii=False
            )
        prompt = args.get("prompt", "")
        ref = args.get("ref_image_path")
        if ref and not Path(ref).is_absolute():
            ref = str(mineru_dir / ref)
        result = await generate_figure(
            prompt, assets_dir, ref, image_model=image_model
        )
        engine = get_engine()
        with Session(engine) as session:
            session.add(
                Asset(
                    paper_id=paper_id,
                    kind="ai_generated",
                    path=result["local_path"],
                    meta_json=json.dumps(
                        {"prompt": prompt, "image_model": result.get("image_model", image_model)},
                        ensure_ascii=False,
                    ),
                )
            )
            session.commit()
        rel = f"assets/{Path(result['local_path']).name}"
        result["url"] = rel
        return format_tool_output(result, paper_id)

    return handler
