PAPER_SUMMARY_SYSTEM = """你是学术论文助手。根据提供的论文解析内容，用一句中文概括其核心贡献。
要求：
1. 15-25 字，直接输出摘要句，不要前缀、引号或解释
2. 突出方法/问题/创新点，避免空泛套话
3. 若内容不足，根据已有信息尽量概括"""


def build_summary_user(title: str, excerpt: str) -> str:
    return f"论文标题：{title}\n\n论文内容节选：\n{excerpt}"
