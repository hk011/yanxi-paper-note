# 研析 × QwenPaw Skill 集成

通过 [QwenPaw Skill](https://github.com/agentscope-ai/QwenPaw/blob/main/website/public/docs/skills.zh.md) 让 Agent 按**研析笔记生成方法论**解读论文。无需启动研析后端或 API Key。

## 架构

```
QwenPaw Agent（启用 yanxi Skill）
    │  阅读 SKILL.md 中的流程与 Prompt
    ▼
Agent 工具：读 PDF / 联网搜索 / 文生图 / 写 Markdown
    │  ① 提取 parsed.md + images/
    │  ② 阶段一：解读大纲
    │  ③ 阶段二：六章并行起草
    │  ④ 阶段三：综合重写 → note.md
    │  ⑤ Markdown → PDF
    ▼
send_file_to_user(note.pdf)
```

## 安装

1. 将 `integrations/qwenpaw-skill/` 打成 zip（含 `SKILL.md`）
2. 在 QwenPaw **工作区 → 技能 → ZIP 导入**，启用 **yanxi**
3. 无需额外环境变量

## 使用示例

> 用研析解读 `D:/papers/transformer.pdf`，把 PDF 笔记发给我

Agent 应按 `SKILL.md` 执行三阶段流水线，将 `note.md` 转为 PDF 后 `send_file_to_user` 交付 `{论文简称}_yanxi_note.pdf`。

## 重新打包 Skill

修改 `SKILL.md` 后重新打 zip 并导入 QwenPaw：

```powershell
cd integrations\qwenpaw-skill
Compress-Archive -Path SKILL.md -DestinationPath ..\qwenpaw-skill.zip -Force
```

---

官方 QwenPaw：[https://github.com/agentscope-ai/QwenPaw](https://github.com/agentscope-ai/QwenPaw)
