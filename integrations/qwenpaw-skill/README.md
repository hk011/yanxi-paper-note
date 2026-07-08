# 研析 × QwenPaw Skill 集成

通过 [QwenPaw Skill](https://github.com/agentscope-ai/QwenPaw/blob/main/website/public/docs/skills.zh.md) 让 Agent 按**研析笔记生成方法论**解读论文，无需启动研析 Web 后端。

## 架构

```
QwenPaw Agent（启用 yanxi Skill）
    │  Step 1–7 流水线（SKILL.md）
    ▼
① PaddleOCR 解析 PDF（失败/超时 → Kreuzberg）→ parsed.md + images/
② web_search（可选 Agent Reach）
③ 三阶段笔记 → note.md
④ note.md → note.pdf
⑤ 交付前自检（PDF 文字非乱码、原图非乱图）→ send_file_to_user
```

## 与 Web 端的差异

| 能力 | Web 端 | Skill |
|------|--------|-------|
| PDF 解析 | MinerU VLM | **PaddleOCR**（首选）→ **Kreuzberg**（备选） |
| 联网 | 火山 web_search | web_search；可选 Agent Reach |
| 笔记规范 | note_pipeline 三阶段 | 与 Web 端 Prompt 一致 |
| 交付 | Web 导出 | Agent 转 PDF + 交付前自检 |

## 安装

1. 将 `integrations/qwenpaw-skill/` 打成 zip（仅含 `SKILL.md`）
2. QwenPaw **工作区 → 技能 → ZIP 导入**，启用 **yanxi**
3. 无需 `YANXI_API_KEY`；Agent 按需安装 PaddleOCR（`pip install "paddleocr[doc-parser]"`）或备选 Kreuzberg（`pip install kreuzberg`）

## 重新打包

```powershell
cd integrations\qwenpaw-skill
Compress-Archive -Path SKILL.md -DestinationPath ..\qwenpaw-skill.zip -Force
```

---

官方 QwenPaw：[https://github.com/agentscope-ai/QwenPaw](https://github.com/agentscope-ai/QwenPaw)
