# Changelog

本文件记录研析的版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

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

[0.0.1]: https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.1
[0.0.0]: https://github.com/hk011/yanxi-paper-note/releases/tag/v0.0.0
