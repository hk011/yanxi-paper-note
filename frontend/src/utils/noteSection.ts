import {
  extractMarkdownImages,
  type MarkdownImageRef,
} from "./markdownImages";

function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 提取指定小节正文（不含标题行） */
export function findSectionBody(content: string, heading: string): string {
  const target = normalizeHeading(heading);
  const lines = content.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && normalizeHeading(m[2]) === target) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+/);
    if (hm && hm[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

/** 本节 Markdown 中引用的图片 */
export function extractSectionImageRefs(
  noteContent: string,
  heading: string
): MarkdownImageRef[] {
  const body = findSectionBody(noteContent, heading);
  if (!body.trim()) return [];
  return extractMarkdownImages(body);
}
