---
name: yanxi
description: |
  研析论文解读：MinerU 解析 + 中文笔记（联网检索 + AI 配图）。
  触发词：研析、yanxi、解读论文、论文笔记、yanxi_cli。
  必须用 scripts/yanxi_cli.py process，并用 send_file_to_user 发送 CLI 输出的 PDF/ZIP。
  禁止自行把 Markdown 转成 PDF 或 HTML 占位 PDF。
metadata:
  requires:
    bins: [python]
    env: [YANXI_API_KEY, YANXI_BASE_URL]
---

# 研析（Yanxi）论文解读 Skill

## 核心原则（必须遵守）

1. **禁止自行写笔记或自制 PDF**：不要读 PDF 后用模型总结；不要把 `.md` 或 HTML 转成 PDF（会出现「图片占位」且文件无法打开）。
2. **必须执行 CLI**：`python scripts/yanxi_cli.py process "<PDF绝对路径>"`
3. **交付 CLI 输出的文件**：
  - 成功时 stdout 为 `*_yanxi_note.pdf`（后端内嵌 base64 图片，与 Web 导出一致）
  - PDF 若失败，CLI 自动改下 `*_yanxi_note.zip`（解压后用浏览器打开 `note.html` 可见全部图片）
  - 使用 `**send_file_to_user`** 发送该 PDF 或 ZIP 路径
4. **禁止**只发 Markdown 或自行拼接的 HTML 当作最终笔记。
5. **长任务**：`timeout` ≥ 7200 秒，或开启 `execute_shell_command` 异步执行。

## 配置

- `YANXI_BASE_URL` = `http://127.0.0.1:8000`
- `YANXI_API_KEY` = 与 `.env` 中 `yanxi_api_key` 相同

## 标准流程

```bash
python scripts/yanxi_cli.py process "D:/papers/attention.pdf"
```

- stderr 会显示 `图片统计: 已嵌入 N，缺失 M`
- stdout 打印可交付文件路径（`.pdf` 或 `.zip`）

```bash
send_file_to_user <stdout 打印的路径>
```

## 已有 paper_id

```bash
python scripts/yanxi_cli.py download-pdf <paper_id> -o "D:/out/note.pdf"
# PDF 仍失败时：
python scripts/yanxi_cli.py download-zip <paper_id> -o "D:/out/note.zip"
```

## 故障排查


| 现象             | 处理                                                                 |
| -------------- | ------------------------------------------------------------------ |
| PDF 500 / 无法打开 | 不要自制 PDF；用 CLI 下载或发 zip；重启后端并 `pip install Pillow`                 |
| 图片缺失           | 确认 stderr 嵌入数 > 0；检查 `backend/data/.../mineru/images` 或 MinerU zip |
| 401            | 检查 `YANXI_API_KEY`                                                 |


## 参考

- `integrations/qwenpaw-skill/README.md`

