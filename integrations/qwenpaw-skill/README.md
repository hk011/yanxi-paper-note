# 研析 × QwenPaw Skill 集成

通过 [QwenPaw Skill](https://github.com/agentscope-ai/QwenPaw/blob/main/website/public/docs/skills.zh.md) 调用研析，生成与 **Web 端一致** 的中文解读笔记，并默认导出 **带内嵌图片的 PDF**（与网页「导出 PDF」相同）。

## 架构

```
QwenPaw Agent（启用 yanxi Skill）
    │  execute_shell_command
    ▼
scripts/yanxi_cli.py process paper.pdf
    │  POST /api/skill/process（解析 + 笔记流水线）
    │  GET  /api/skill/papers/{id}/note/export/pdf（内嵌图片）
    ▼
*_yanxi_note.pdf（内嵌图片）或 *_yanxi_note.zip（兜底）
    →  send_file_to_user
```

> **禁止** QwenPaw 自行把 Markdown/HTML 转成 PDF。必须由后端 `/api/skill/.../export/pdf` 生成。

## 1. 配置研析后端

### 研析 API Key 获取方式

`yanxi_api_key` 用于 Skill / CLI 通过 HTTP 头 `X-Yanxi-Api-Key` 调用 `/api/skill/*`，需自行生成 **API Key**。

**方式：**

```bash
python integrations/get_yanxi_api_key.py
```

终端会输出 API Key，复制到项目根目录 `.env`：

```env
yanxi_api_key=此处粘贴生成的API Key
yanxi_username=qwenpaw
```

QwenPaw Skill 配置中的 `YANXI_API_KEY` 需与 `.env` 里 `yanxi_api_key` **完全一致，SKILL.md 的配置中** `YANXI_API_KEY 也要一致`。

### 后端环境变量与启动

```env
mineru_api_token=...
ark_key=...
ark_multi_model_list=...

yanxi_api_key=此处粘贴上文生成的字符串
yanxi_username=qwenpaw
```

```bash
cd backend && conda activate yanxi
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```



## 2. 安装 Skill 到 QwenPaw

将 `integrations/qwenpaw-skill/` 打成 zip（含 `SKILL.md`、`scripts/`），在 **工作区 → 技能 → ZIP 导入** 并启用 **yanxi**。

Skill 配置：


| Key              | 值                             |
| ---------------- | ----------------------------- |
| `YANXI_BASE_URL` | `http://127.0.0.1:8000`       |
| `YANXI_API_KEY`  | 与 `.env` 中 `yanxi_api_key` 相同 |


```bash
pip install httpx
```



## 3. 使用示例

对 QwenPaw 说：

> 用研析解读 `D:/papers/transformer.pdf`，把带图的 PDF 笔记发给我

Agent 应执行：

```bash
python scripts/yanxi_cli.py process "D:/papers/transformer.pdf"
```

然后用 `**send_file_to_user**` 发送 stdout 输出的 `transformer_yanxi_note.pdf`。

手动测试：

```powershell
cd integrations\qwenpaw-skill
$env:YANXI_BASE_URL="http://127.0.0.1:8000"
$env:YANXI_API_KEY="你的密钥"
python scripts\yanxi_cli.py process "D:\path\to\paper.pdf"
```



## 4. Skill API


| 方法   | 路径                                       | 说明                     |
| ---- | ---------------------------------------- | ---------------------- |
| POST | `/api/skill/process`                     | 上传 PDF，同步跑解析+笔记        |
| GET  | `/api/skill/papers/{id}/note/export/pdf` | **带图 PDF**（与 Web 导出一致） |
| GET  | `/api/skill/papers/{id}/note`            | Markdown 原文            |
| POST | `/api/skill/papers/{id}/ask`             | 论文问答                   |




## 5. CLI 命令


| 命令                        | 说明                              |
| ------------------------- | ------------------------------- |
| `process <pdf>`           | 全流程 + 默认导出 `*_yanxi_note.pdf`   |
| `process <pdf> --save-md` | 同时保存 `.md`                      |
| `download-pdf <id>`       | 已有论文补下 PDF                      |
| `get-note <id>`           | 默认 PDF；`--format md` 为 Markdown |




## 6. 长任务

- 默认 HTTP 超时 7200 秒
- QwenPaw 中 `execute_shell_command` 建议开启异步或加大 timeout

---

官方 QwenPaw：[https://github.com/agentscope-ai/QwenPaw](https://github.com/agentscope-ai/QwenPaw)