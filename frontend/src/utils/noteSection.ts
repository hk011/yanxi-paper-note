import {
  extractMarkdownImages,
  type MarkdownImageRef,
} from "./markdownImages";

function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function lookupHeading(
  content: string,
  heading: string
): { text: string; level: number } | null {
  const target = normalizeHeading(heading);
  for (const line of content.split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && normalizeHeading(m[2]) === target) {
      return { text: m[2].trim(), level: m[1].length };
    }
  }
  return null;
}

/** 提取指定标题下正文（## 整章含 ###；### 仅本小节） */
export function findSectionBody(content: string, heading: string): string {
  const found = lookupHeading(content, heading);
  const target = normalizeHeading(found?.text ?? heading);
  const level = found?.level ?? 0;
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && normalizeHeading(m[2]) === target) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  const startLevel = level || lines[start].match(/^(#{1,6})/)?.[1].length || 0;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+/);
    if (hm && hm[1].length <= startLevel) break;
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
