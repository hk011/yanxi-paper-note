# 研析 (Yanxi)

> AI 拆解论文，人人都能读懂前沿研究

上传英文 PDF 论文，自动解析为结构化 Markdown，并生成中文解读笔记；支持论文问答、小节配图/润色、联网搜索与 AI 配图。

[License: MIT](LICENSE)
[Version](https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.9)

## 最新动态

- [2026.06.09] **v0.0.9** 笔记全文翻译；文献库卡片/列表视图与文件夹归类；AI 摘要封面与阅读进度 → [完整更新日志](CHANGELOG.md)
- [2026.06.06] **v0.0.8** DeepSeek 内置模型（Flash/Pro 优先）；论文问答全屏展开与关闭按钮优化 → [完整更新日志](CHANGELOG.md)
- [2026.06.03] **v0.0.7** 修复笔记流式渲染开头反复闪烁（v0.0.6 remount 回归）→ [完整更新日志](CHANGELOG.md)
- [2026.05.31] **v0.0.6** Sensenova 文生图可选；配图 prompt 规范升级与引号修正；删图重生成与即时刷新修复 → [完整更新日志](CHANGELOG.md)
- [2026.05.26] **v0.0.5** 笔记生成过程服务端持久化；二/三级标题配图与润色范围修正；配图中文标注提示 → [完整更新日志](CHANGELOG.md)
- [2026.05.25] **v0.0.4** 自定义模型千帆 MCP 联网；配图提示词优化（16:9 / 多模态）；联网结果展示修复 → [完整更新日志](CHANGELOG.md)
- [2026.05.24] **v0.0.3** 问答可选 AI 配图开关；小节润色预览确认；配图路径与删图修复 → [完整更新日志](CHANGELOG.md)
- [2026.05.24] **v0.0.1** 小节添加配图与 AI 润色；修复笔记图片显示错乱 → [完整更新日志](CHANGELOG.md)
- [2026.05.24] **v0.0.0** 首个公开发布：PDF 解析、流式笔记、论文问答、AI 配图



## 功能

- 用户注册 / 登录
- PDF 上传与解析（SSE 实时进度）
- 原文 PDF / 解析 Markdown / 解读笔记三栏对照
- 大模型流式笔记生成
- 小节添加配图、小节 AI 润色（Seedream 学术信息图）
- 论文问答（文本 + 图片、联网搜索；内置 Ark 或自定义模型 + 千帆 MCP）
- 自定义模型联网（笔记生成 / 问答 / 润色，需配置千帆 Web Search Key）
- 笔记导出（Markdown / PDF）



## 技术栈


| 层级     | 技术                                                           |
| ------ | ------------------------------------------------------------ |
| 前端     | React 18、TypeScript、Vite、Ant Design                          |
| 后端     | Python 3.11+、FastAPI、Uvicorn                                 |
| 数据库    | SQLite（`backend/yanxi.db`，首次启动自动建表）                          |
| 用户文件   | `backend/data/{user_id}/{paper_id}/`                         |
| PDF 解析 | [MinerU](https://mineru.net) VLM                             |
| 大模型    | [火山方舟](https://www.volcengine.com/product/ark) Responses API |
| 图像生成   | 火山方舟 Seedream                                                |




## 外部 API

本项目依赖第三方 API，**需自行申请密钥，费用按各平台计费**。

### MinerU（PDF 解析）

- 注册：[mineru.net](https://mineru.net)
- 用途：PDF → Markdown，提取文本、公式、图表
- 使用 VLM 多模态解析模式



### 火山方舟（大模型 + 生图）

- 注册：[火山方舟控制台](https://console.volcengine.com/ark)

**大模型（笔记生成、论文问答）**

- 需使用支持**多模态**（vision）的模型，以便处理论文问答中的图片附件
- 需开通**联网检索**工具（`web_search`）
- 在 `.env` 的 `ark_multi_model_list` 中配置，多个模型 ID 用**英文逗号**分隔，前端可切换

**图像生成（笔记配图）**

- 推荐 Seedream 5.0（如 `doubao-seedream-5-0-260128`）
- 在 `.env` 的 `ark_image_gen_model` 中配置



## 快速开始



### 环境要求

- Python 3.11+
- Node.js 18+
- Conda（推荐）或 Python venv



### 1. 克隆并配置

```bash
git clone https://github.com/hk011/yanxi-paper-note.git
cd yanxi-paper-note
cp .env.example .env
```

编辑 `.env`，填入 MinerU Token、火山方舟 API Key，以及 JWT 密钥（生产环境请使用随机字符串）。

### 2. 启动后端

```bash
cd backend
conda env create -f environment.yml   # 首次，或改用 venv + pip install -r requirements.txt
conda activate yanxi
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```



### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 **[http://localhost:5173](http://localhost:5173)**

### 4. 使用

1. 注册并登录
2. 上传 PDF 论文，等待解析完成
3. 生成解读笔记，或使用论文问答



## QwenPaw Skill 集成（供其他 Agent 调用）

通过 [QwenPaw Skill](https://github.com/agentscope-ai/QwenPaw) 或其他支持 `SKILL.md` 的 Agent，调用研析完整流水线（解析 + 笔记 + 带图 PDF 导出）。

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

Agent 侧 Skill 配置中的 `YANXI_API_KEY` 需与 `.env` 里 `yanxi_api_key` **完全一致，SKILL.md 的配置中** `YANXI_API_KEY 也要一致`。

### 接入步骤

1. 按上文生成并配置 `yanxi_api_key`（见 `.env.example`）
2. 按 `[integrations/qwenpaw-skill/README.md](integrations/qwenpaw-skill/README.md)` 导入 Skill 并配置 `YANXI_API_KEY`
3. Agent 执行 `yanxi_cli.py process <pdf>`，用 `send_file_to_user` 交付 `*_yanxi_note.pdf`

Skill API：`POST /api/skill/process`、`GET /api/skill/papers/{id}/note/export/pdf` 等，详见 Skill 文档。

## 数据库

- **SQLite** 单文件：`backend/yanxi.db`
- 启动时自动建表（User、Paper、Note、Asset、Conversation、Message）
- 用户 PDF、笔记、头像等文件存于 `backend/data/`



## License

[MIT](LICENSE)