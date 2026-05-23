# 研析 (Yanxi)

> AI 拆解论文，人人都能读懂前沿研究

上传英文 PDF 论文，自动解析为结构化 Markdown，并生成中文解读笔记；支持论文问答、联网搜索与 AI 配图。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 功能概览

- 用户注册 / 登录（JWT）
- PDF 上传与 [MinerU](https://mineru.net) VLM 解析（SSE 实时进度）
- 原文 PDF / 解析 Markdown / 解读笔记三栏对照
- [火山方舟](https://www.volcengine.com/product/ark) 大模型流式笔记生成
- 论文问答（支持文本 + 图片附件、联网搜索、思考过程展示）
- 笔记导出（Markdown / PDF）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18、TypeScript、Vite、Ant Design |
| 后端 | Python 3.11+、FastAPI、Uvicorn |
| 数据库 | **SQLite**（文件：`backend/yanxi.db`，首次启动自动建表） |
| ORM | SQLModel（6 张表：User、Paper、Note、Asset、Conversation、Message） |
| 用户文件 | 本地目录 `backend/data/{user_id}/{paper_id}/`（PDF、解析结果、笔记、头像） |
| PDF 解析 | MinerU API（`model_version: vlm`，视觉语言模型） |
| 大模型 | 火山方舟 Responses API（笔记生成、问答） |
| 图像生成 | 火山方舟 Seedream（笔记配图工具 `gen_figure`） |

## 外部 API 与模型要求

本项目依赖两个第三方 API，**需自行申请密钥，费用按各平台计费**。

### 1. MinerU（PDF 解析）

- 申请：[mineru.net](https://mineru.net)
- 用途：将 PDF 转为 Markdown，提取文本、公式、图表
- 模式：**VLM 多模态解析**（见 `backend/app/services/mineru.py`）

### 2. 火山方舟 Ark（大模型 + 生图）

- 申请：[火山方舟控制台](https://console.volcengine.com/ark)
- 笔记生成 / 问答模型（`.env` 中 `ark_multi_model_list`）：
  - 推荐：`doubao-seed-2-0-pro-260215`（多模态，支持 vision）
  - 可选：`doubao-seed-2-0-lite-260428`
- 配图模型（`ark_image_gen_model`）：
  - `doubao-seedream-5-0-260128`
- **多模态说明**：
  - PDF 解析的多模态由 MinerU VLM 完成
  - 笔记生成主流程基于 Markdown 文本 + 图片路径清单
  - 论文问答上传图片时，需 Ark 模型支持 **vision**（input_image）
  - 笔记中的 AI 配图走 Seedream 图像生成 API，可引用论文原图

## 项目结构

```
yanxi/
├── README.md                 # 本文件
├── LICENSE                   # MIT
├── .env.example              # 环境变量模板
├── docs/
│   └── design/
│       └── product-design.md # 产品设计文档
├── assets/
│   └── brand/                # Logo 设计源文件
├── backend/
│   ├── app/                  # FastAPI 应用
│   ├── data/                 # 用户上传文件（gitignore，运行时生成）
│   ├── yanxi.db              # SQLite 数据库（gitignore，运行时生成）
│   ├── requirements.txt
│   └── environment.yml       # Conda 环境
├── frontend/
│   ├── public/brand/         # 运行时 Logo（favicon 等）
│   └── src/                  # React 源码
└── scripts/
    ├── start-backend.sh
    └── start-frontend.sh
```

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- Conda（推荐）或 Python venv

### 1. 克隆仓库

```bash
git clone https://github.com/hk011/yanxi-paper-note.git
cd yanxi-paper-note
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的密钥：

```env
mineru_api_token=你的_MinerU_Token
ark_key=你的_火山方舟_API_Key
jwt_secret=随机长字符串   # 生产环境务必修改，可用 openssl rand -hex 32 生成
```

### 3. 启动后端

**方式 A：Conda（推荐）**

```bash
cd backend
conda env create -f environment.yml   # 首次
conda activate yanxi
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**方式 B：venv**

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 **http://localhost:5173**

### 一键脚本（需先 `conda activate yanxi`）

```bash
./scripts/start-backend.sh   # 终端 1
./scripts/start-frontend.sh  # 终端 2
```

### 5. 验证

1. 注册账号并登录
2. 上传一篇 PDF 论文
3. 等待 MinerU 解析完成（页面有 SSE 进度）
4. 生成解读笔记或进入论文问答

## 数据库说明

- **类型**：SQLite 单文件数据库
- **路径**：`backend/yanxi.db`（可在 `.env` 通过代码配置修改，默认见 `backend/app/core/config.py`）
- **初始化**：后端启动时自动 `create_all` 建表，并执行轻量列迁移
- **数据目录**：用户 PDF、解析 Markdown、笔记、头像等存于 `backend/data/`
- **适用场景**：本地开发、单机部署；多实例生产环境建议迁移 PostgreSQL + 对象存储

## 开发分支

| 分支 | 用途 |
|------|------|
| `main` | 稳定版本，对外发布 |
| `develop` | 日常开发 |

```bash
# 日常在 develop 开发
git checkout develop
git add . && git commit -m "feat: xxx"
git push origin develop

# 功能稳定后合并到 main
git checkout main
git merge develop
git push origin main
git checkout develop
```

## 生产构建

```bash
cd frontend && npm run build    # 产物在 frontend/dist/
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

生产环境需配置 Nginx 反代、HTTPS、强 JWT Secret，并限制注册/API 调用频率。

## 更多文档

- [复现指南（详细步骤与排错）](docs/SETUP.md)
- [产品设计文档](docs/design/product-design.md)

## License

[MIT](LICENSE)
