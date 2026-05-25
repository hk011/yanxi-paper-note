"""Seedream 学术信息图 / 示意图提示词（火山方舟 Seedream 4.0–5.0 指南）

官方建议：
- 提示词建议不超过约 300 个汉字（软限制，非 API 硬上限）
- 图内文字用英文双引号包裹，每处宜短，总量不宜过多
- 笔记配图统一 16:9（2560x1440 @ 2K）
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SEEDREAM_PROMPT_SOFT_MAX_CHARS = 400

# 笔记配图统一 16:9
NOTE_FIGURE_ASPECT = "16:9"
NOTE_FIGURE_SIZE = "2560x1440"

FigureKind = Literal[
    "infographic",
    "architecture",
    "flow",
    "comparison",
    "mechanism",
    "roadmap",
    "pipeline",
    "timeline",
    "equation_board",
]

GEN_FIGURE_TYPES = """
- 学术信息图：多个要点分区展示，每区配简洁扁平图标与短标签
- 模型架构图：模块分层或分栏，箭头表示数据流
- 算法流程图：步骤编号、判断菱形、分支，流向明确
- 方法对比图：并列对比基线 vs 改进，差异高亮
- 机制原理图：核心机制居中，输入/处理/输出与因果箭头
- 系统管线图：多阶段流水线，阶段名称清晰
- 技术路线图：阶段、里程碑与逻辑顺序
- 时序交互图：多方按时间顺序的调用与交互
- 教学板书图：黑板/白板背景，公式与推导步骤
""".strip()

GEN_FIGURE_STYLE_NOTE = (
    "16:9 横构图，扁平矢量插画风格，色彩明快，可适当拟人化或比喻化表达以便理解，"
    "信息准确、结构清晰，无立体阴影、无水印、无照片写实感"
)

# 图内文字说明的统一要求（工具描述、模板、兜底共用）
FIGURE_IN_IMAGE_TEXT_RULE = (
    "图中须配备文字说明：每个分区/模块/步骤/箭头旁都要有简短标题或一句解释性标注，"
    "帮助读者理解画面含义；不要只有图形而无文字。"
    "所有图内文字（中文、英文、公式片段）必须用英文双引号 \"...\" 逐字写出。"
)

GEN_FIGURE_TOOL_DESC = f"""生成论文解读笔记配图（Seedream，固定 16:9）。优先引用论文已有原图；仅当需要更直观示意时再生成。

调用前请你分析：什么样的图最能帮助读者理解**当前正在讨论的论文内容**。

`prompt` 参数必须是**完整、可直接交给文生图模型**的中文提示词：
1. 高信息密度：画面类型、16:9 构图、整体布局（分区、箭头、流向、主次）、风格配色、各区域画什么。
2. 整份笔记配图可采用生动、易懂、适度拟人化/比喻的视觉表达（信息仍须准确）。
3. {FIGURE_IN_IMAGE_TEXT_RULE}
4. 不要写「参考知识」段，不要粘贴大段原文；建议 200–400 字。

可选 `ref_image_path`：论文相关原图本地路径（如 images/xxx.jpg），用于构图参考。
无需填写 `figure_kind`（系统统一 16:9）。"""

# 规则拼装兜底模板（优化 LLM 失败时使用）
GEN_FIGURE_PROMPT_TEMPLATE = """绘制一张【图的类型】，16:9 构图，展示【展示内容】。
布局：【布局要求】。
风格：【风格要求】。
文字：""" + FIGURE_IN_IMAGE_TEXT_RULE

GEN_FIGURE_STYLE_ACADEMIC = GEN_FIGURE_STYLE_NOTE


@dataclass(frozen=True)
class FigureProfile:
    kind: FigureKind
    type_label: str
    layout: str
    aspect: Literal["16:9"] = "16:9"
    display_subject: str = ""


ASPECT_TO_SIZE = {
    "16:9": NOTE_FIGURE_SIZE,
}

FIGURE_KIND_ASPECT: dict[str, str] = {k: "16:9" for k in (
    "infographic",
    "architecture",
    "flow",
    "comparison",
    "mechanism",
    "roadmap",
    "pipeline",
    "timeline",
    "equation_board",
)}


def infer_figure_profile(heading: str, section_body: str = "") -> FigureProfile:
    """根据小节标题与正文推断图类型与布局（宽高比固定 16:9）。"""
    blob = f"{heading} {section_body}".lower()
    subject = (heading or "本节要点").strip()

    if any(k in blob for k in ("方程", "公式", "推导", "证明", "lemma", "equation")):
        return FigureProfile(
            kind="equation_board",
            type_label="教学板书示意图",
            layout="深色黑板背景，自上而下分步展示公式与变换，关键步骤高亮",
            display_subject=subject,
        )
    if any(k in blob for k in ("对比", "vs", "相较", "baseline", "ablation", "比较")):
        return FigureProfile(
            kind="comparison",
            type_label="方法对比示意图",
            layout="左右两栏并列，差异模块用强调色边框标出",
            display_subject=subject,
        )
    if any(
        k in blob
        for k in ("架构", "architecture", "encoder", "decoder", "模块", "network", "u-net")
    ):
        return FigureProfile(
            kind="architecture",
            type_label="模型架构示意图",
            layout="自上而下分层或左→右分模块，箭头表示特征流向",
            display_subject=subject,
        )
    if any(k in blob for k in ("流程", "算法", "步骤", "pipeline", "训练", "推理", "workflow")):
        return FigureProfile(
            kind="flow",
            type_label="算法流程图",
            layout="左→右步骤流，矩形表步骤、菱形表判断，箭头标明流向",
            display_subject=subject,
        )
    if any(k in blob for k in ("路线", "roadmap", "阶段", "里程碑", "技术路线")):
        return FigureProfile(
            kind="roadmap",
            type_label="技术路线图",
            layout="横向阶段条，每阶段色块与短标题，阶段间箭头连接",
            display_subject=subject,
        )
    if any(k in blob for k in ("时序", "交互", "协议", "握手", "调用顺序", "sequence")):
        return FigureProfile(
            kind="timeline",
            type_label="时序交互示意图",
            layout="横向泳道，各方按时间排列，箭头标注调用方向",
            display_subject=subject,
        )
    if any(k in blob for k in ("管线", "多阶段", "流水线", "pipeline", "系统")):
        return FigureProfile(
            kind="pipeline",
            type_label="系统管线图",
            layout="左→右多阶段方框，每阶段名称与输入输出箭头",
            display_subject=subject,
        )
    if any(k in blob for k in ("机制", "原理", "因果", "attention", "注意力", "作用", "为什么")):
        return FigureProfile(
            kind="mechanism",
            type_label="机制原理示意图",
            layout="中心为核心机制，四周标注输入、处理、输出，箭头表因果",
            display_subject=subject,
        )
    return FigureProfile(
        kind="infographic",
        type_label="学术信息图",
        layout="3–5 个要点独立分区，每区图标与短标签，分区间箭头或编号表关系",
        display_subject=subject,
    )


def build_academic_figure_prompt(
    *,
    heading: str,
    instruction: str = "",
    profile: FigureProfile | None = None,
    section_body: str = "",
) -> str:
    """规则拼装兜底（无多模态优化时使用）。"""
    prof = profile or infer_figure_profile(heading, section_body)
    prompt = GEN_FIGURE_PROMPT_TEMPLATE.replace("【图的类型】", prof.type_label)
    prompt = prompt.replace("【展示内容】", prof.display_subject)
    prompt = prompt.replace("【布局要求】", prof.layout)
    prompt = prompt.replace("【风格要求】", GEN_FIGURE_STYLE_NOTE)
    extra = (instruction or "").strip()
    if extra:
        prompt = f"{prompt}\n补充要求：{extra}"
    if len(prompt) > SEEDREAM_PROMPT_SOFT_MAX_CHARS:
        prompt = prompt[: SEEDREAM_PROMPT_SOFT_MAX_CHARS].rstrip() + "…"
    return prompt.strip()


def resolve_figure_size(
    profile: FigureProfile | None = None,
    *,
    heading: str = "",
    section_body: str = "",
) -> str:
    del profile, heading, section_body
    return NOTE_FIGURE_SIZE


def resolve_figure_size_for_kind(
    figure_kind: str | None = None,
    *,
    heading: str = "",
    section_body: str = "",
) -> str:
    del figure_kind, heading, section_body
    return NOTE_FIGURE_SIZE


def enhance_figure_prompt(user_prompt: str) -> str:
    """发给 Seedream 前的轻量兜底。"""
    text = (user_prompt or "").strip()
    if not text:
        return text
    extras: list[str] = []
    if "16:9" not in text and "16：9" not in text:
        extras.append("构图比例 16:9，适配笔记排版。")
    if "文字" not in text and '"' not in text:
        extras.append(FIGURE_IN_IMAGE_TEXT_RULE)
    elif '"' not in text:
        extras.append('图中所有文字须用英文双引号 "..." 逐字写出，并为各区域配备解释性标注。')
    if extras:
        return f"{text}\n" + " ".join(extras)
    return text
