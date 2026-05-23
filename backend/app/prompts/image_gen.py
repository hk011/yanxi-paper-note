"""Seedream 配图提示词基调（参考火山方舟 Seedream 4.0-5.0 提示词指南）"""

# https://www.volcengine.com/docs/82379/1829186?lang=zh
GEN_FIGURE_TOOL_DESC = """根据描述生成配图（Seedream），用于你认为「画图比纯文字更好理解」的段落。
由你决定画什么、图题叫什么；优先用论文原图，本工具作补充示意。
prompt 用自然语言写清主体、关系、布局与风格；可选 ref_image_path 传入相关论文原图路径作参考。"""

GEN_FIGURE_PROMPT_SUFFIX = (
    "，清晰克制的学术示意风格，结构清楚，中文标签可读，白底，无装饰水印"
)


def enhance_figure_prompt(user_prompt: str) -> str:
    """为模型简述补上统一视觉基调，避免风格漂移。"""
    text = (user_prompt or "").strip()
    if not text:
        return text
    if "白底" in text or "示意" in text:
        return text
    return f"{text}{GEN_FIGURE_PROMPT_SUFFIX}"
