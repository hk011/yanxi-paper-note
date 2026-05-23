/** 从 AI 编辑助手回复中解析完整笔记 Markdown */
export function extractNoteMarkdownFromAssistant(content: string): string | null {
  const text = (content || "").trim();
  if (!text) return null;
  const match = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  if (match?.[1]) return match[1].trim();
  return null;
}

/** 气泡中展示的简短说明（代码块之前部分） */
export function assistantDisplayForNoteEdit(content: string): string {
  const text = (content || "").trim();
  if (!text) return "";
  const idx = text.search(/```(?:markdown|md)?\s*\n/i);
  if (idx <= 0) return text;
  const summary = text.slice(0, idx).trim();
  if (summary) return summary;
  return "已更新笔记全文（见完成编辑后预览）";
}
