/** 打印专用文档内联样式（iframe 内仅含笔记，自然分页） */
export const PRINT_DOCUMENT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #202124;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.note-print-root {
  max-width: 100%;
  padding: 0;
}
.note-print-title {
  display: block;
  font-family: Inter, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.35;
  color: #0f1419;
  margin: 0 0 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eef0f3;
}
.markdown-body {
  font-family: "Source Serif 4", "Songti SC", "Noto Serif CJK SC", "STSong", Georgia, serif;
  font-size: 14px;
  line-height: 1.72;
  color: #202124;
}
.markdown-body p,
.markdown-body li,
.markdown-body blockquote,
.markdown-body td,
.markdown-body th {
  word-break: break-word;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-weight: 600;
  line-height: 1.35;
  margin: 1.4em 0 0.5em;
  color: #0f1419;
  page-break-after: avoid;
}
.markdown-body h1 { font-size: 1.6em; }
.markdown-body h2 { font-size: 1.35em; }
.markdown-body h3 { font-size: 1.15em; }
.markdown-body p { margin: 0.6em 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.4em; }
.markdown-body li { margin: 0.2em 0; }
.markdown-body blockquote {
  margin: 1em 0;
  padding: 0.4em 1em;
  border-left: 3px solid #d6dee7;
  background: #f7f8fa;
  page-break-inside: avoid;
}
.markdown-body code {
  font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: #f3f4f6;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.markdown-body pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  page-break-inside: avoid;
}
.markdown-body pre code { background: transparent; color: inherit; padding: 0; }
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 0.9em;
  page-break-inside: avoid;
}
.markdown-body th, .markdown-body td {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
}
.markdown-body th { background: #f7f8fa; font-weight: 600; }
.markdown-body img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.6em auto;
  page-break-inside: avoid;
}
.markdown-body a { color: #1677ff; text-decoration: none; }

/* KaTeX：避免被正文 word-break 拆行；隐藏 MathML 无障碍层 */
.note-print-root .katex {
  font-size: 1.05em;
}
.note-print-root .katex,
.note-print-root .katex * {
  word-break: normal;
  overflow-wrap: normal;
}
.note-print-root .katex .katex-mathml {
  clip: rect(1px, 1px, 1px, 1px) !important;
  border: 0 !important;
  height: 1px !important;
  overflow: hidden !important;
  padding: 0 !important;
  position: absolute !important;
  width: 1px !important;
}
/* 块级公式：外层居中，内层按内容收缩，避免 .hbox/.frac-line 被拉满整页宽 */
.note-print-root .katex-display {
  display: block;
  margin: 1em 0;
  overflow: visible;
  page-break-inside: avoid;
  text-align: center;
}
.note-print-root .katex-display > .katex {
  display: inline-block !important;
  width: auto !important;
  max-width: 100%;
  text-align: center;
}
.note-print-root .katex-display > .katex > .katex-html {
  display: inline-block !important;
  width: auto !important;
  max-width: 100%;
}
.note-print-root .katex .base {
  width: min-content;
  max-width: 100%;
}
.note-print-root .katex .katex-html {
  display: inline-block;
  max-width: 100%;
}
`;
