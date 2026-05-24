const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const IMG_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export interface MarkdownImageRef {
  alt: string;
  src: string;
}

/** 将图片路径规范为可比较的 key（assets/gen_001.png 等） */
export function normalizeImageSrcKey(src: string): string {
  const raw = src.trim().replace(/^\/+/, "");
  const apiMatch = raw.match(/(?:^|\/)files\/(.+)$/i);
  if (apiMatch?.[1]) return apiMatch[1].replace(/^\/+/, "");
  return raw;
}

export function extractMarkdownImages(content: string): MarkdownImageRef[] {
  const out: MarkdownImageRef[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(IMG_RE)) {
    const src = match[2]?.trim();
    if (!src) continue;
    const key = normalizeImageSrcKey(src);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ alt: match[1] ?? "", src });
  }
  return out;
}

export function parseImageLine(text: string): MarkdownImageRef | null {
  const m = text.trim().match(IMG_LINE_RE);
  if (!m) return null;
  return { alt: m[1] ?? "", src: m[2]?.trim() ?? "" };
}

export function diffMarkdownImages(oldContent: string, newContent: string) {
  const oldImgs = extractMarkdownImages(oldContent);
  const newImgs = extractMarkdownImages(newContent);
  const oldKeys = new Set(oldImgs.map((i) => normalizeImageSrcKey(i.src)));
  const newKeys = new Set(newImgs.map((i) => normalizeImageSrcKey(i.src)));

  const added = newImgs.filter((i) => !oldKeys.has(normalizeImageSrcKey(i.src)));
  const removed = oldImgs.filter((i) => !newKeys.has(normalizeImageSrcKey(i.src)));
  const unchanged = newImgs.filter((i) => oldKeys.has(normalizeImageSrcKey(i.src)));

  return { added, removed, unchanged };
}
