"""Seedream 学术信息图 / 示意图提示词（火山方舟 Seedream 4.0–5.0 指南）

官方建议：
- 提示词建议不超过约 300 个汉字（软限制，非 API 硬上限）
- 图内中文标签用引号包裹，每处宜短（3–8 字），总量不宜过多
- size 可指定像素或 2K/4K；宽高比 [1/16, 16]

参考示例（火山风格）：
- 「在黑板上画出下列二元一次方程组及其相应的解法步骤：…」→ 教学板书类
- 「绘制一张信息图，展示通货膨胀的成因，每条成因独立呈现，并配有简洁图标」→ 分区信息图
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

# 发给 Seedream 的「参考知识」段上限（为主提示留出约 200 字）
SEEDREAM_REFERENCE_MAX_CHARS = 200
# 整段 prompt 软上限（超出时优先压缩参考知识）
SEEDREAM_PROMPT_SOFT_MAX_CHARS = 300

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

# LLM 工具说明用：图的类型清单
GEN_FIGURE_TYPES = """
- 学术信息图：多个要点分区展示，每区配简洁扁平图标与短标签（如成因、模块、步骤列表）
- 模型架构图：神经网络/系统模块分层或分栏，箭头表示数据流与张量流向
- 算法流程图：步骤编号、判断菱形、循环与分支，流程方向明确
- 方法对比图：左右或上下并列对比基线 vs 改进方案，差异模块高亮
- 机制原理图：核心机制居中，输入/处理/输出分区，因果箭头
- 系统管线图：多阶段流水线，左→右或上→下，阶段名称清晰
- 技术路线图：研究阶段、里程碑、时间或逻辑顺序
- 时序交互图：多方/多模块按时间顺序的调用与交互
- 教学板书图：黑板/白板背景，公式与推导步骤（适合公式、定理）
""".strip()

# 统一主模板（一键配图 & LLM 填参均遵循）
GEN_FIGURE_PROMPT_TEMPLATE = """绘制一张【图的类型】，展示【展示内容】。
布局：【布局要求】。
风格：【风格要求】。
文字：图中需要出现的中文标签用引号标注，例如「模块A」「步骤1」，每处标签 3–8 个字，全图主标签不超过 5 处。
参考知识：【参考知识】"""

GEN_FIGURE_STYLE_ACADEMIC = (
    "纯白底、扁平矢量学术示意图，低饱和蓝灰为主色、橙色或绿色高亮创新/关键模块，"
    "线条清晰、结构层级分明，无立体阴影、无花哨装饰、无水印、无照片写实感"
)

GEN_FIGURE_TOOL_DESC = f"""根据描述生成论文解读用配图（Seedream）。优先引用论文原图；仅当原图不足以说明时再生成。

你必须按下列模板组织 prompt（替换【】内容，不要保留【】）：
{GEN_FIGURE_PROMPT_TEMPLATE}

填写规则：
1. 【图的类型】从下列选最贴切的一种：{GEN_FIGURE_TYPES.replace(chr(10), " ")}
2. 【展示内容】一句话说明这张图让读者看懂什么（可用论文小节标题为主语）
3. 【布局要求】写清分区/箭头/流向，如「横向四栏」「左→右流程」「左右对比」「中心机制+四周标注」
4. 【风格要求】默认使用：{GEN_FIGURE_STYLE_ACADEMIC}
5. 【参考知识】由你根据当前段落提炼 2–5 句关键信息（勿整段粘贴原文）；若调用时已有小节全文，以工具参数 reference_knowledge 为准

可选参数 figure_kind 帮助系统选择合适宽高比；有论文原图时务必填 ref_image_path（本地绝对路径）。

示例：
绘制一张学术信息图，展示「压缩稀疏注意力 CSA」的核心思想与三步流程。
布局：横向三块分区，每块上方小图标、下方短标签，块间箭头表示顺序。
风格：{GEN_FIGURE_STYLE_ACADEMIC}
文字：标签为「压缩」「稀疏选择」「局部窗口」。
参考知识：CSA 先压缩 KV 缓存，再稀疏注意力，滑动窗口保留局部依赖。"""


@dataclass(frozen=True)
class FigureProfile:
    kind: FigureKind
    type_label: str
    layout: str
    aspect: Literal["16:9", "4:3", "3:4", "1:1"]
    display_subject: str


# 宽高比 → Seedream 2K 像素（适配 5.0-lite / 4.5）
ASPECT_TO_SIZE = {
    "16:9": "2560x1440",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "1:1": "2048x2048",
}


def infer_figure_profile(heading: str, section_body: str = "") -> FigureProfile:
    """根据小节标题与正文推断图类型、布局与宽高比。"""
    blob = f"{heading} {section_body}".lower()
    subject = (heading or "本节要点").strip()

    if any(k in blob for k in ("方程", "公式", "推导", "证明", "lemma", "equation")):
        return FigureProfile(
            kind="equation_board",
            type_label="教学板书示意图",
            layout="深色黑板背景，自上而下分步写出公式与变换，关键步骤用粉笔色高亮",
            aspect="4:3",
            display_subject=subject,
        )
    if any(k in blob for k in ("对比", "vs", "相较", "baseline", "ablation", "比较")):
        return FigureProfile(
            kind="comparison",
            type_label="方法对比示意图",
            layout="左右两栏并列，左栏基线方法、右栏本文方法，差异模块用强调色边框标出",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("架构", "architecture", "encoder", "decoder", "模块", "network", "u-net")):
        return FigureProfile(
            kind="architecture",
            type_label="模型架构示意图",
            layout="自上而下分层或左→右分模块，箭头表示张量/特征流向，关键层用强调色",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("流程", "算法", "步骤", "pipeline", "训练", "推理", "workflow")):
        return FigureProfile(
            kind="flow",
            type_label="算法流程图",
            layout="左→右或上→下步骤流，矩形表示步骤、菱形表示判断，箭头标明流向",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("路线", "roadmap", "阶段", "里程碑", "技术路线")):
        return FigureProfile(
            kind="roadmap",
            type_label="技术路线图",
            layout="横向时间轴或阶段条，每阶段独立色块与短标题，阶段间箭头连接",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("时序", "交互", "协议", "握手", "调用顺序", "sequence")):
        return FigureProfile(
            kind="timeline",
            type_label="时序交互示意图",
            layout="横向泳道或时间轴，各方/模块按时间顺序排列，箭头标注调用方向",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("管线", "多阶段", "流水线", "pipeline", "系统")):
        return FigureProfile(
            kind="pipeline",
            type_label="系统管线图",
            layout="左→右多阶段方框，每阶段名称与输入输出箭头，阶段内可含子步骤",
            aspect="16:9",
            display_subject=subject,
        )
    if any(k in blob for k in ("机制", "原理", "因果", "attention", "注意力", "作用", "为什么")):
        return FigureProfile(
            kind="mechanism",
            type_label="机制原理示意图",
            layout="中心为核心机制示意，四周分区标注输入、处理、输出，箭头表示因果关系",
            aspect="1:1",
            display_subject=subject,
        )
    # 默认：学术信息图（多要点）
    return FigureProfile(
        kind="infographic",
        type_label="学术信息图",
        layout="3–5 个要点独立分区，每区配简洁扁平图标与短标签，分区之间箭头或编号表示关系",
        aspect="4:3",
        display_subject=subject,
    )


def compress_reference_knowledge(text: str, max_chars: int = SEEDREAM_REFERENCE_MAX_CHARS) -> str:
    """压缩参考知识，优先保留完整短段，超长时按句界截断。"""
    body = re.sub(r"\s+", " ", (text or "").strip())
    if not body:
        return ""
    if len(body) <= max_chars:
        return body
    cut = body[:max_chars]
    for sep in ("。", "；", "！", "？", ". ", "; "):
        idx = cut.rfind(sep)
        if idx > max_chars // 2:
            return cut[: idx + len(sep)].strip() + "…"
    return cut.rstrip() + "…"


def build_academic_figure_prompt(
    *,
    heading: str,
    reference_knowledge: str = "",
    instruction: str = "",
    profile: FigureProfile | None = None,
) -> str:
    """组装发给 Seedream 的完整中文 prompt。"""
    prof = profile or infer_figure_profile(heading, reference_knowledge)
    ref = compress_reference_knowledge(reference_knowledge or heading)

    prompt = GEN_FIGURE_PROMPT_TEMPLATE.replace("【图的类型】", prof.type_label)
    prompt = prompt.replace("【展示内容】", prof.display_subject)
    prompt = prompt.replace("【布局要求】", prof.layout)
    prompt = prompt.replace("【风格要求】", GEN_FIGURE_STYLE_ACADEMIC)
    prompt = prompt.replace("【参考知识】", ref or heading)

    extra = (instruction or "").strip()
    if extra:
        prompt = f"{prompt}\n补充要求：{extra}"

    if len(prompt) > SEEDREAM_PROMPT_SOFT_MAX_CHARS:
        overflow = len(prompt) - SEEDREAM_PROMPT_SOFT_MAX_CHARS
        shorter_ref = compress_reference_knowledge(
            ref, max(60, len(ref) - overflow - 10)
        )
        prompt = GEN_FIGURE_PROMPT_TEMPLATE.replace("【图的类型】", prof.type_label)
        prompt = prompt.replace("【展示内容】", prof.display_subject)
        prompt = prompt.replace("【布局要求】", prof.layout)
        prompt = prompt.replace("【风格要求】", GEN_FIGURE_STYLE_ACADEMIC)
        prompt = prompt.replace("【参考知识】", shorter_ref or heading[:80])
        if extra:
            prompt = f"{prompt}\n补充要求：{extra}"

    return prompt.strip()


def resolve_figure_size(
    profile: FigureProfile | None = None,
    *,
    heading: str = "",
    section_body: str = "",
) -> str:
    """按图类型返回 Seedream size 参数（像素字符串）。"""
    prof = profile or infer_figure_profile(heading, section_body)
    return ASPECT_TO_SIZE.get(prof.aspect, "2560x1440")


FIGURE_KIND_ASPECT: dict[str, str] = {
    "infographic": "4:3",
    "architecture": "16:9",
    "flow": "16:9",
    "comparison": "16:9",
    "mechanism": "1:1",
    "roadmap": "16:9",
    "pipeline": "16:9",
    "timeline": "16:9",
    "equation_board": "4:3",
}


def resolve_figure_size_for_kind(
    figure_kind: str | None = None,
    *,
    heading: str = "",
    section_body: str = "",
) -> str:
    """LLM 传入 figure_kind 时优先按其宽高比；否则从小节或正文推断。"""
    kind = (figure_kind or "").strip()
    if kind in FIGURE_KIND_ASPECT:
        return ASPECT_TO_SIZE.get(FIGURE_KIND_ASPECT[kind], "2560x1440")
    return resolve_figure_size(
        infer_figure_profile(heading, section_body or heading)
    )


def enhance_figure_prompt(user_prompt: str) -> str:
    """兜底：若调用方传入的 prompt 过短，补上学术风格约束。"""
    text = (user_prompt or "").strip()
    if not text:
        return text
    if any(k in text for k in ("白底", "学术", "信息图", "参考知识", "布局")):
        return text
    return (
        f"{text}\n风格：{GEN_FIGURE_STYLE_ACADEMIC}。"
        "文字标签用引号标注，每处 3–8 字，无水印。"
    )
