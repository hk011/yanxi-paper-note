"""学术信息图 / 示意图文生图提示词规范（笔记配图统一 16:9）"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

FIGURE_PROMPT_SOFT_MAX_CHARS = 1500  # 仅作参考/日志，不截断

NOTE_FIGURE_ASPECT = "16:9"
NOTE_FIGURE_SIZE = "2560x1440"
SENSENOVA_FIGURE_SIZE = "2752x1536"  # 16:9 @ 2K

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
- 学术信息图：多个要点分区展示，每区配简洁扁平图标与完整文字标签
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

FIGURE_PRIMARY_LANGUAGE_RULE = "图内文字以中文为主，专有名词、公式符号等可用英文。"

FIGURE_QUOTE_RULE = (
    "图内所有需渲染的文字必须完整写出，包括主标题、副标题、模块标题、正文说明、数据标签、"
    "坐标轴标签、图例、口号、来源声明等，禁止用省略号代替。"
    "每一处图内文字都必须用中文双引号 ”” 包裹并逐字写出，"
    "例如 主标题”数据采集”、卡片正文”多源异构数据统一接入”、"
    "英文标签 ”Epoch”、数值 ”Loss 0.42”；"
    "禁止使用方括号引号「」、单层「文字」或嵌套「”…”」等写法。"
)

# 向后兼容旧 import
FIGURE_IN_IMAGE_TEXT_RULE = FIGURE_QUOTE_RULE

FIGURE_WRITING_PRINCIPLES = (
    "提示词应全面、细致、具象化，涵盖整体视觉风格、布局结构、颜色方案、字体设计、"
    "图标与插图样式、文字内容（逐字逐句）、数据呈现方式，以及装饰性元素。"
    "描述时使用精确方位词（左上角、右侧中部、底部、环绕等），"
    "并明确各元素之间的视觉连接关系（箭头、虚线、发光管道、连接线等）。"
    "即使输入仅为概要，也需基于合理推测将模糊点补全为可执行的视觉描述，"
    "但不得偏离主题、数据和关键信息。"
)

FIGURE_PROMPT_STRUCTURE_GUIDE = (
    "输出须为连贯段落（不要分条列点），按以下逻辑组织："
    "(a) 整体概览：主题/标题、整体设计风格、背景颜色/纹理、主辅色、总体构图与网格系统；"
    "(b) 模块逐一描述：每个区块的位置、标题文字（原样用引号写出）、视觉形式、"
    "图表类型与坐标轴/图例/数据点数值、图标风格与配色；"
    "(c) 连接与导航：区块间的箭头/虚线/道路等引导元素与整体叙事逻辑；"
    "(d) 装饰与氛围：背景装饰、特殊效果（霓虹、阴影等）、品牌元素。"
)

FIGURE_DATA_ENCODING_RULES = (
    "数值类数据优先选用合适图表（柱状图、折线图、环形图等），"
    "并明确坐标轴含义、刻度范围与数据点具体数值；"
    "百分比/比例用饼图、堆叠条形图或图标阵列表示并写出具体百分比；"
    "对比数据用分组柱状图或双轴线图并明确色码含义；"
    "流程/步骤用编号箭头或垂直阶梯，每步配图标与完整文字；"
    "分类/特性用图标加文字列表、矩阵表格或卡片式布局。"
    "凡涉及数字必须写明具体数值，禁止使用「一些」「很多」等模糊词。"
)

GEN_FIGURE_PROMPT_EXAMPLE = (
    "（形态示例，勿照抄内容）"
    "绘制一张 16:9 学术信息图。整体概览：主标题”数据-centric AI 核心框架”，"
    "副标题”从数据质量到模型性能的全链路”。"
    "整体为杂志排版风格，浅灰蓝渐变背景带 faint 网格纹理，主色 #2563EB、强调色 #F97316，"
    "采用三列网格构图。"
    "模块描述：左上角第一卡片标题”数据采集”，下方正文”多源异构数据统一接入”，"
    "配扁平数据库图标；中央卡片标题”质量评估”，内含环形图标注 ”准确率 92%”、"
    "”覆盖率 87%”；右侧卡片标题”模型训练”，含折线图 X 轴 ”Epoch”、Y 轴 ”Loss”，"
    "数据点标注 ”0.42→0.08”。"
    "连接与导航：三卡片之间用橙色实线箭头从左至右连接，箭头旁标注”数据流向”。"
    "装饰与氛围：背景散布 faint 二进制代码与几何圆点，卡片带轻微阴影。"
)

GEN_FIGURE_TOOL_DESC = f"""生成论文解读笔记配图（文生图，固定 16:9）。优先引用论文已有原图；仅当需要更直观示意时再生成。

调用前分析：什么样的图最能帮助读者理解**当前正在讨论的论文内容**。

`prompt` 参数必须是**完整、可直接交给文生图 API** 的中文提示词（详细连贯段落，建议 600–1500 字）：
{FIGURE_WRITING_PRINCIPLES}
{FIGURE_PROMPT_STRUCTURE_GUIDE}
{FIGURE_PRIMARY_LANGUAGE_RULE}
{FIGURE_QUOTE_RULE}
{FIGURE_DATA_ENCODING_RULES}
- 不要写「参考知识」段，不要粘贴大段原文。
- 可采用生动、易懂的视觉表达（信息仍须准确）。

{GEN_FIGURE_PROMPT_EXAMPLE}

可选 `ref_image_path`：论文相关原图本地路径（如 images/xxx.jpg），用于构图参考。
无需填写 `figure_kind`（系统统一 16:9）。"""

NOTE_GEN_FIGURE_BRIEF = f"""【gen_figure 配图工具（文生图，固定 16:9）】
- 仅当「画一张图能明显帮助读者理解当前内容」时再调用；优先引用论文原图。
- `prompt` 须为可直接交给文生图 API 的详细连贯段落（建议 600–1500 字），按整体概览→模块→连接→装饰组织。
- {FIGURE_PRIMARY_LANGUAGE_RULE} {FIGURE_QUOTE_RULE}
- 数值须具体，禁止模糊词；完整规范见 gen_figure 工具描述。
- 有对应论文原图时可填 ref_image_path 作构图参考；生成后在笔记中用 ![](assets/文件名.png) 引用。"""

GEN_FIGURE_STYLE_ACADEMIC = GEN_FIGURE_STYLE_NOTE

_STRUCTURE_KEYWORDS = (
    "整体概览",
    "模块",
    "连接",
    "装饰",
    "左上角",
    "右上角",
    "左下角",
    "右下角",
    "中央",
    "底部",
    "顶部",
)


@dataclass(frozen=True)
class FigureProfile:
    kind: FigureKind
    type_label: str
    layout: str
    composition: str
    module_hint: str
    connection_hint: str
    decor_hint: str
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


def _quote_cn(text: str) -> str:
    return f'"{text}"'


def _extract_section_bullets(section_body: str, limit: int = 3) -> list[str]:
    """从 Markdown 正文抽取要点，供兜底 prompt 填充模块。"""
    bullets: list[str] = []
    for line in (section_body or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        m = re.match(r"^[-*+]\s+(.+)", stripped)
        if m:
            text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", m.group(1))
            text = re.sub(r"`([^`]+)`", r"\1", text)
            text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
            text = text.strip()
            if len(text) >= 4:
                bullets.append(text[:80])
        elif re.match(r"^#{1,6}\s+", stripped):
            title = re.sub(r"^#{1,6}\s+", "", stripped).strip()
            if title and title not in bullets:
                bullets.append(title[:80])
        if len(bullets) >= limit:
            break
    if not bullets and section_body:
        plain = re.sub(r"[#*`>\[\]()!]", " ", section_body)
        plain = " ".join(plain.split())
        if plain:
            bullets.append(plain[:60])
    return bullets


def infer_figure_profile(heading: str, section_body: str = "") -> FigureProfile:
    """根据小节标题与正文推断图类型与布局（宽高比固定 16:9）。"""
    blob = f"{heading} {section_body}".lower()
    subject = (heading or "本节要点").strip()

    if any(k in blob for k in ("方程", "公式", "推导", "证明", "lemma", "equation")):
        return FigureProfile(
            kind="equation_board",
            type_label="教学板书示意图",
            layout="深色黑板背景，自上而下分步展示公式与变换，关键步骤高亮",
            composition="上下分层，主公式居中偏上，推导步骤纵向排列",
            module_hint="顶部主标题，中部公式区逐步展开，底部结论区",
            connection_hint="纵向虚线箭头连接各推导步骤，步骤编号 1→2→3",
            decor_hint="黑板粉笔质感、 faint 网格线、角落 chalk 粉尘效果",
            display_subject=subject,
        )
    if any(k in blob for k in ("对比", "vs", "相较", "baseline", "ablation", "比较")):
        return FigureProfile(
            kind="comparison",
            type_label="方法对比示意图",
            layout="左右两栏并列，差异模块用强调色边框标出",
            composition="左右对称双栏，中央分隔线",
            module_hint="左栏基线方法、右栏改进方法，各含柱状图或指标卡片",
            connection_hint="中央双向箭头标注差异维度，底部汇总条",
            decor_hint="差异模块橙色高亮边框，背景浅灰",
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
            composition="三层垂直堆叠或左→右模块链",
            module_hint="输入层、编码器、解码器、输出层各为独立色块",
            connection_hint="实线箭头标注张量流向，旁注维度变化",
            decor_hint="模块圆角矩形、浅蓝灰底、模块间留白清晰",
            display_subject=subject,
        )
    if any(k in blob for k in ("流程", "算法", "步骤", "pipeline", "训练", "推理", "workflow")):
        return FigureProfile(
            kind="flow",
            type_label="算法流程图",
            layout="左→右步骤流，矩形表步骤、菱形表判断，箭头标明流向",
            composition="横向流程，分支用菱形判断节点",
            module_hint="每步矩形内含步骤编号与动作说明",
            connection_hint="编号箭头 1→2→3，分支处标注条件文字",
            decor_hint="步骤框统一圆角，判断菱形黄色填充",
            display_subject=subject,
        )
    if any(k in blob for k in ("路线", "roadmap", "阶段", "里程碑", "技术路线")):
        return FigureProfile(
            kind="roadmap",
            type_label="技术路线图",
            layout="横向阶段条，每阶段色块与短标题，阶段间箭头连接",
            composition="横向时间轴，4–5 个阶段色块",
            module_hint="每阶段含里程碑图标与阶段名称",
            connection_hint="阶段间粗箭头，下方标注时间或版本",
            decor_hint="里程碑旗帜图标，背景 faint 时间刻度",
            display_subject=subject,
        )
    if any(k in blob for k in ("时序", "交互", "协议", "握手", "调用顺序", "sequence")):
        return FigureProfile(
            kind="timeline",
            type_label="时序交互示意图",
            layout="横向泳道，各方按时间排列，箭头标注调用方向",
            composition="多泳道横向时序图",
            module_hint="每泳道代表一个角色，消息用水平箭头",
            connection_hint="虚线返回箭头表示响应，标注时序编号",
            decor_hint="泳道背景交替浅色，消息箭头带标签",
            display_subject=subject,
        )
    if any(k in blob for k in ("管线", "多阶段", "流水线", "pipeline", "系统")):
        return FigureProfile(
            kind="pipeline",
            type_label="系统管线图",
            layout="左→右多阶段方框，每阶段名称与输入输出箭头",
            composition="水平流水线，5–6 个阶段方框",
            module_hint="每阶段方框含阶段名与输入/输出说明",
            connection_hint="阶段间粗箭头，旁注数据格式",
            decor_hint="管道式连接视觉，阶段色块渐变",
            display_subject=subject,
        )
    if any(k in blob for k in ("机制", "原理", "因果", "attention", "注意力", "作用", "为什么")):
        return FigureProfile(
            kind="mechanism",
            type_label="机制原理示意图",
            layout="中心为核心机制，四周标注输入、处理、输出，箭头表因果",
            composition="中心辐射式，核心机制居中",
            module_hint="上方输入、中央机制、下方输出，四周辅助说明",
            connection_hint="因果箭头从输入指向机制再指向输出",
            decor_hint="核心模块放大强调，环绕 faint 光晕",
            display_subject=subject,
        )
    return FigureProfile(
        kind="infographic",
        type_label="学术信息图",
        layout="3–5 个要点独立分区，每区图标与完整标签，分区间箭头或编号表关系",
        composition="三列或四象限网格",
        module_hint="每区含图标、模块标题、一句正文说明",
        connection_hint="分区间编号箭头或虚线连接表示逻辑关系",
        decor_hint="背景 faint 几何装饰，分区卡片带浅阴影",
        display_subject=subject,
    )


def _build_module_paragraph(
    prof: FigureProfile,
    heading: str,
    bullets: list[str],
) -> str:
    positions = ["左上角", "中央偏上", "右上角", "左下角", "右下角", "底部中央"]
    parts: list[str] = []
    default_titles = [heading, "核心要点", "关键结论", "补充说明"]
    for i, pos in enumerate(positions[: max(3, len(bullets))]):
        title = bullets[i] if i < len(bullets) else default_titles[min(i, len(default_titles) - 1)]
        parts.append(
            f"{pos}区块标题{_quote_cn(title)}，"
            f"形式为扁平图标加文字卡片，"
            f"正文说明{_quote_cn(f'展示与{title}相关的核心信息')}，"
            f"配色以蓝色系为主、橙色作强调。"
        )
    return " ".join(parts[:3])


def build_academic_figure_prompt(
    *,
    heading: str,
    instruction: str = "",
    profile: FigureProfile | None = None,
    section_body: str = "",
) -> str:
    """规则拼装兜底（无多模态优化时使用）。"""
    prof = profile or infer_figure_profile(heading, section_body)
    bullets = _extract_section_bullets(section_body)
    main_title = (heading or prof.display_subject or "本节要点").strip()
    module_para = _build_module_paragraph(prof, main_title, bullets)

    overview = (
        f"绘制一张{prof.type_label}，16:9 横构图。"
        f"主标题{_quote_cn(main_title)}。"
        f"整体风格为{GEN_FIGURE_STYLE_NOTE}。"
        f"背景为浅灰蓝渐变带 faint 网格纹理，主色 #2563EB、强调色 #F97316，"
        f"采用{prof.composition}。"
    )
    modules = f"模块描述：{module_para} {prof.module_hint}。"
    connections = (
        f"连接与导航：{prof.connection_hint}。"
        f"整体叙事逻辑为从左至右、从输入到输出的阅读顺序，"
        f"箭头旁须标注完整文字说明。"
    )
    decor = f"装饰与氛围：{prof.decor_hint}。{FIGURE_QUOTE_RULE}"

    prompt = f"{overview} {modules} {connections} {decor}"
    extra = (instruction or "").strip()
    if extra:
        prompt = f"{prompt} 补充要求：{extra}"
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


def _normalize_figure_quotes(text: str) -> str:
    """将误用的「"..."」/「文字」统一为 "..."。"""
    text = re.sub(r'「"([^"]*?)"」', r'"\1"', text)
    text = re.sub(r'「([^」]+?)」', r'"\1"', text)
    return text


def _has_figure_quotes(text: str) -> bool:
    if "「" in text or "」" in text:
        return False
    return bool(re.search(r'"[^"]{1,}"', text))


def enhance_figure_prompt(user_prompt: str) -> str:
    """发给文生图 API 前的轻量兜底。"""
    text = _normalize_figure_quotes((user_prompt or "").strip())
    if not text:
        return text
    extras: list[str] = []
    if "16:9" not in text and "16：9" not in text:
        extras.append("构图比例 16:9，适配笔记排版。")
    if not _has_figure_quotes(text):
        extras.append(FIGURE_QUOTE_RULE)
    if not any(kw in text for kw in _STRUCTURE_KEYWORDS):
        extras.append(
            "请按整体概览、模块逐一描述、连接与导航、装饰与氛围的逻辑组织成连贯段落。"
        )
    if extras:
        return f"{text}\n" + " ".join(extras)
    return text
