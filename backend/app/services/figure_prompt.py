"""配图 prompt 与尺寸解析（供小节配图、gen_figure 工具共用）"""

from __future__ import annotations

from app.prompts.image_gen import (
    FigureProfile,
    build_academic_figure_prompt,
    compress_reference_knowledge,
    infer_figure_profile,
    resolve_figure_size,
    resolve_figure_size_for_kind,
)

__all__ = [
    "FigureProfile",
    "build_academic_figure_prompt",
    "compress_reference_knowledge",
    "infer_figure_profile",
    "resolve_figure_size",
    "resolve_figure_size_for_kind",
]
