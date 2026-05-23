# 研析 (Yanxi)

PDF 论文 → MinerU 解析 → 结构化中文解读笔记

## 功能

- 用户注册 / 登录（JWT）
- PDF 上传与 MinerU VLM 解析（SSE 进度推送）
- 原文 PDF / 解析 Markdown / 双栏对照
- 方舟大模型流式笔记生成、论文问答

## 环境要求

- Python 3.11+（推荐 Conda）
- Node.js 18+

## 配置

复制模板并填入自己的密钥：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|---|---|
| `mineru_api_token` | [MinerU](https://mineru.net) PDF 解析 API Token |
| `ark_key` | [火山方舟](https://console.volcengine.com/ark) API Key |
| `jwt_secret` | JWT 签名密钥，生产环境请使用随机字符串 |

第三方 API 按各自平台计费，部署者需自行申请并承担费用。

## 启动

### 后端（Conda，推荐）

```bash
cd backend
conda env create -f environment.yml   # 首次
conda activate yanxi
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

若环境已存在，仅需 `conda activate yanxi`。

### 后端（venv 备选）

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173

也可使用一键脚本（需先 `conda activate yanxi`）：

```bash
./scripts/start-backend.sh   # 终端 1
./scripts/start-frontend.sh  # 终端 2
```

## 开发分支

- `main` — 稳定版本，对外发布
- `develop` — 日常开发分支

日常在 `develop` 上开发，功能稳定后合并到 `main`。

## License

[MIT](LICENSE)
