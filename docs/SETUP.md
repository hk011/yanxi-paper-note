# 复现指南

本文档帮助开发者从零跑通研析项目。

## 前置条件检查

| 项 | 要求 |
|---|---|
| Python | 3.11 或更高 |
| Node.js | 18 或更高 |
| MinerU Token | 在 [mineru.net](https://mineru.net) 注册并获取 |
| 火山方舟 API Key | 在 [控制台](https://console.volcengine.com/ark) 开通模型接入点 |
| 磁盘空间 | 建议预留 2GB+（含 PDF 与用户数据） |

## 模型接入点配置

在火山方舟控制台创建以下模型的**推理接入点**，并确保 API Key 有调用权限：

1. **文本/多模态大模型**（笔记生成、论文问答）
   - `doubao-seed-2-0-pro-260215`（推荐，支持 vision）
   - 或 `doubao-seed-2-0-lite-260428`

2. **图像生成模型**（笔记配图）
   - `doubao-seedream-5-0-260128`

将模型 ID 填入 `.env`：

```env
ark_multi_model_list=doubao-seed-2-0-pro-260215,doubao-seed-2-0-lite-260428
ark_image_gen_model=doubao-seedream-5-0-260128
```

## 完整启动流程

```bash
# 1. 克隆
git clone https://github.com/hk011/yanxi-paper-note.git
cd yanxi-paper-note
git checkout develop   # 开发版在此分支

# 2. 配置密钥
cp .env.example .env
# 编辑 .env 填入 mineru_api_token、ark_key、jwt_secret

# 3. 后端
cd backend
conda env create -f environment.yml
conda activate yanxi
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 4. 前端（新终端）
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 常见问题

### 解析一直卡住

- 检查 `mineru_api_token` 是否有效
- 查看后端终端是否有 MinerU API 报错
- MinerU 为云端异步任务，大 PDF 可能需要数分钟

### 笔记生成失败

- 确认 `ark_key` 有效且模型接入点已开通
- 确认 `.env` 中模型 ID 与控制台一致

### 登录后 API 401

- 检查 `jwt_secret` 是否在启动后修改过（修改会使旧 Token 失效）
- 清除浏览器 localStorage 后重新登录

### 数据库在哪里

- SQLite 文件：`backend/yanxi.db`
- 删除此文件可重置所有用户与论文数据（开发调试用）

## 目录与资产

| 路径 | 说明 |
|------|------|
| `frontend/public/brand/` | 网站运行时 Logo（256px / 48px） |
| `assets/brand/` | Logo 设计源文件（1024px 透明 PNG） |
| `backend/data/` | 运行时用户数据，勿手动删除正在使用的文件 |
| `docs/design/product-design.md` | 产品设计文档 |
