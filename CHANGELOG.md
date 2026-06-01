# Changelog

本文件记录研析的版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.0.6] - 2026-05-31

### Added

- 商汤 Sensenova 文生图接入，与豆包 Seedream 双 provider 可选（`.env` 配置 `SENSENOVA_*`）
- 前端 `ImageModelPicker`：笔记生成、小节配图、问答配图均可选择文生图模型
- 配图 prompt 规范升级：四段式结构（整体概览→模块→连接→装饰），建议 600–1500 字详细段落
- 文生图最终 prompt 与优化器输出终端打印，便于排查图内标题等问题

### Changed

- `gen_figure` 工具描述、小节配图优化器、规则兜底模板同步新规范；移除 prompt 400 字截断
- 图内文字引号规则：一律用中文双引号 `""` 包裹，禁止 `「」`；`enhance_figure_prompt` 自动归一化误用格式

### Fixed

- 删除配图后重新生成：gen 文件名单调递增，清除 blob 缓存，避免不同模型仍显示旧图
- 增删配图后即时刷新笔记：API 返回最新 content、`Cache-Control: no-store`、配图 URL 缓存破除

## [0.0.5] - 2026-05-26

### Added

- 笔记生成过程持久化：流水线结束时写入 `note_generation_trace.json`，新增 `GET /note/generation-trace`；前端加载完成后从服务端恢复（跨设备可查看）
- 笔记小节操作：二级（`##`）与三级（`###`）标题显示「添加配图 / 润色本节」；四级及以下不再显示

### Changed

- 小节配图 / 润色范围：点击二级标题按整章处理，点击三级标题仅处理该小节；配图插入在点击的标题下方
- `gen_figure` 提示词补充「图内文字以中文为主，专有名词可用英文」

### Fixed

- 历史笔记无 localStorage 生成过程时，展示「已完成」占位栏；有服务端 trace 时正常展开步骤

## [0.0.4] - 2026-05-25

### Added

- 自定义模型（OpenAI 兼容）经千帆 MCP / REST 联网搜索，可用于笔记生成、论文问答、小节润色
- 千帆 MCP 配置项（`web_search_mcp_server` / `web_search_mcp_server_key`）与前端「可联网」状态展示
- 自定义模型每环节最多 2 次联网调用，控制配额消耗
- 小节配图：多模态 LLM 优化 Seedream 提示词（`figure_optimizer`），默认 16:9，强调图内英文标注
- 小节润色：默认带上本节已有图片，支持上传/粘贴参考图；自定义模型不支持识图时给出提示

### Fixed

- 笔记 `gen_figure` / 小节配图提示词模板与工具描述对齐（去掉「参考知识」、布局与图内文字规则）
- 联网搜索结果前端展示：解析 MCP 返回的 `results`、补全 `tool_delta` 转发与历史消息还原
- 配置热更新：移除 `get_settings` 缓存，`.env` 保存后无需重启即可识别 MCP Key

## [0.0.3] - 2026-05-24

### Added

- 论文问答「AI 配图」开关（默认关闭，与联网搜索并列）；开启后可调用 gen_figure，生成图可用「融入笔记」写入解读

### Fixed

- 小节润色改为 diff 预览后再保存，修复确认后笔记无变化的问题
- gen 配图 404：统一 `assets/` 与 `images/gen/` 路径解析
- 删图时移除笔记中该图的全部引用（非仅一处）
- 失效配图在笔记中显示提示并可「移除引用」

### Changed

- 小节润色 diff 默认全部接受；问答关闭配图时引导使用小节「添加配图」

## [0.0.1] - 2026-05-24

### Added

- 小节添加配图：在章节标题旁一键生成学术信息图/架构图/流程图，自动推断图类型与宽高比
- 小节 AI 润色：支持自定义提示词与示例 chip，可选深度思考、联网搜索
- 配图删除：可删除 AI 生成的配图（Markdown 引用、磁盘文件、Asset 一并清理）

### Fixed

- 笔记中图片与图注布局错乱
- 表格居中显示
- gen 配图预览与 diff 对齐

### Changed

- 学术配图 prompt 模板统一（风格、比例、Seedream 参数）
- Chat 专注论文问答，配图改走小节内嵌流程
- 笔记保存改为原地覆盖，不再每次递增版本号

## [0.0.0] - 2026-05-24

### Added

- 首个公开发布：PDF 解析、流式笔记生成、论文问答、联网搜索、AI 配图
- 自定义模型接入（OpenAI 兼容 API）
- 笔记版本备份与切换

### Changed

- v0.0.1 起：整篇 AI 编辑调整为小节级润色/配图

[0.0.3]: https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.3
[0.0.1]: https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.1
[0.0.0]: https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.0
