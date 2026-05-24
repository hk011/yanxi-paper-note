# Changelog

本文件记录研析的版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

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
