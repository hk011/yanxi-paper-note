"""笔记生成 Prompt 模板"""

from app.prompts.image_gen import NOTE_GEN_FIGURE_BRIEF

_NOTE_SYSTEM_COMMON = f"""你是一位资深科研论文解读专家，擅长将英文学术论文转化为结构化、通俗易懂的中文 Markdown 解读笔记。

要求：
1. 使用中文撰写，专业术语可保留英文并附中文解释
2. 输出标准 Markdown，不要包裹在代码块中
3. 引用论文原图时使用 Markdown 图片语法，路径必须从「可用图片清单」中选择，且必须与清单中标注的 Figure/图题一致
{{search_rules}}
7. 表格必须使用标准 GFM Markdown：表格前后各留一个空行，表头、分隔行、数据行独占一行；不要把表格写进列表项、段落、引用块或同一行文本中；表格单元格内不要使用裸竖线，必要时用“/”替代
8. 不要使用 emoji 或特殊彩色符号表示是/否，表格中统一使用“是/否/部分”

{NOTE_GEN_FIGURE_BRIEF}
"""

_SEARCH_RULES_ON = """4. 需要补充背景、综述、解读博客、GitHub 代码等信息时，主动联网检索（内置 Ark 自动搜索，或调用 web_search 工具）
5. 搜索优先：概念背景、相关综述、论文解读博客、GitHub 开源仓库
6. 不要编造不存在的链接；引用搜索结果时标注来源"""

_SEARCH_RULES_OFF = """4. 当前模型不支持联网搜索；仅依据论文原文、解析内容与已有知识撰写
5. 禁止调用 web_search、search 等检索类工具；需要外部背景时写「可进一步检索」而非虚构链接
6. 不要编造不存在的 URL 或引用来源"""


def build_note_system(*, enable_web_search: bool) -> str:
    rules = _SEARCH_RULES_ON if enable_web_search else _SEARCH_RULES_OFF
    return _NOTE_SYSTEM_COMMON.format(search_rules=rules)


# 默认（内置模型）保持联网能力说明
NOTE_SYSTEM = build_note_system(enable_web_search=True)


def build_outline_user(*, enable_web_search: bool) -> str:
    concept_hint = (
        "标注哪些概念可能需要联网补充背景"
        if enable_web_search
        else "标注哪些概念可能需要读者自行查阅背景（勿虚构检索结果）"
    )
    return f"""请根据以下论文结构化解析内容，输出「解读大纲」（纯文本，不要完整笔记）：

1. 论文基础信息表（标题中英文、作者、单位、期刊/会议、发表时间、代码/数据链接——能从文中推断则填，否则标「未提及」）
2. 章节大纲（按论文实际结构）
3. 关键概念列表（中英文，{concept_hint}）
4. 重要图片清单（从正文中识别 Figure 编号 + 说明；后续章节须按清单中的路径引用，不要自行猜测文件名）

【可用图片清单】（含路径绑定，大纲阶段请据此整理图片清单）
{{image_list}}

---
{{paper_skeleton}}
"""


OUTLINE_USER = build_outline_user(enable_web_search=True)

SECTION_DEFS: list[dict[str, str]] = [
    {
        "id": "basic_info",
        "title": "一、论文基础信息",
        "instruction": "撰写「一、论文基础信息」章节。用 Markdown 表格展示标题（原文+译文）、作者、单位、期刊/会议、发表时间、代码库、数据集等。只输出本章内容。",
    },
    {
        "id": "background",
        "title": "二、背景、动机与结果",
        "instruction": "撰写「二、背景、动机与结果」章节：核心贡献总结、研究背景与动机、主要结果概览。{search_hint}只输出本章内容。",
    },
    {
        "id": "methods",
        "title": "三、核心方法",
        "instruction": "撰写「三、核心方法」章节：技术架构详解、关键算法、创新点。必须详细描述论文中的架构图/方案图/模型图（优先引用原图）。若你认为画图更易理解，可调用 gen_figure。只输出本章内容。",
    },
    {
        "id": "experiments",
        "title": "四、实验结果",
        "instruction": "撰写「四、实验结果」章节：实验设置、主要结果分析（引用论文图表并解读）、对比实验（可用表格）。只输出本章内容。",
    },
    {
        "id": "conclusion",
        "title": "五、总结与展望",
        "instruction": "撰写「五、总结与展望」章节：研究价值、局限性、未来方向。只输出本章内容。",
    },
    {
        "id": "reading",
        "title": "六、扩展阅读",
        "instruction": "撰写「六、扩展阅读」章节：相关论文推荐、参考资料与链接（{reading_hint}）。只输出本章内容。",
    },
]

_SECTION_SEARCH_HINT_ON = "需要背景知识时请联网搜索。"
_SECTION_SEARCH_HINT_OFF = "依据论文与解析内容阐述，勿调用联网搜索。"
_SECTION_READING_HINT_ON = "可联网搜索补充"
_SECTION_READING_HINT_OFF = "仅列论文中已提及或可合理推断的参考资料，勿虚构链接"


def section_instruction(section: dict[str, str], *, enable_web_search: bool) -> str:
    inst = section["instruction"]
    if "{search_hint}" in inst:
        hint = _SECTION_SEARCH_HINT_ON if enable_web_search else _SECTION_SEARCH_HINT_OFF
        inst = inst.format(search_hint=hint)
    if "{reading_hint}" in inst:
        hint = _SECTION_READING_HINT_ON if enable_web_search else _SECTION_READING_HINT_OFF
        inst = inst.format(reading_hint=hint)
    return inst


SECTIONS = [
    (d["title"], section_instruction(d, enable_web_search=True)) for d in SECTION_DEFS
]

SECTION_USER_TEMPLATE = """你正在为一篇论文撰写中文解读笔记。

【已完成大纲】
{outline}

【论文结构化内容摘要】
{paper_skeleton}

【可用图片清单】（每项已绑定图题/类型与路径；引用时必须使用箭头右侧的路径，格式：![](images/文件名.jpg)）
{image_list}

【当前任务】
{section_instruction}

请直接输出本章 Markdown 内容（含章节标题如 ## 一、...）。本章独立撰写，无需参考其他章节草稿。
"""

FINAL_NOTE_USER_TEMPLATE = """请基于前面各阶段得到的资料与草稿，输出一篇完整、连贯、图文并茂的中文论文解读笔记。

【论文标题】
{paper_title}

【论文解读大纲】
{outline}

【分阶段草稿材料】（这些只是材料，不要机械拼接；请整体重写成一篇连贯笔记）
{section_drafts}

【论文结构化内容摘要】
{paper_skeleton}

【可用论文原图】（每项已绑定图题/类型与路径；引用时必须使用箭头右侧的路径）
{image_list}

【已生成辅助讲解图】（引用格式：![](assets/文件名.png)）
{generated_images}

输出要求：
1. 只输出最终 Markdown 正文，不要解释过程，不要包裹代码块。
2. 文章结构必须包含：论文基础信息、背景/动机/结果、核心方法、实验结果、总结展望、扩展阅读。
3. 图文并茂：在合适位置插入论文原图和已生成配图（assets/ 路径），并在图下方简要说明图意；AI 生成的配图需注明为示意。
4. 语言要连贯，避免“第一段草稿/第二段草稿”这种拼接感。
5. 所有外部资料链接要标注来源，不要编造来源。
6. 所有 Markdown 表格必须是标准 GFM 表格：表格前后必须空一行，表头、分隔线、每行数据都独占一行；不要在列表项里直接插入表格；如果要说明表格，请先结束列表，再单独输出表格。
7. 表格内避免使用 emoji、HTML、未转义的竖线。是/否统一写“是”“否”“部分”。
"""
