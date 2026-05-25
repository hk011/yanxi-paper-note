/** 从联网搜索 tool 输出 / 事件中解析可展示的引用列表 */

export function extractHitsFromToolOutput(output: unknown): unknown[] {
  if (output == null) return [];

  let obj: Record<string, unknown> | null = null;
  if (typeof output === "string") {
    const text = output.trim();
    if (!text.startsWith("{")) return [];
    try {
      obj = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return [];
    }
  } else if (typeof output === "object") {
    obj = output as Record<string, unknown>;
  }
  if (!obj) return [];

  const topResults = obj.results;
  if (Array.isArray(topResults) && topResults.length > 0) {
    return topResults;
  }

  const references = obj.references;
  if (Array.isArray(references) && references.length > 0) {
    return references;
  }

  const action = (obj.action as Record<string, unknown> | undefined) || {};
  const actionRefs = action.sources || action.results;
  if (Array.isArray(actionRefs) && actionRefs.length > 0) {
    return actionRefs;
  }

  const url =
    (obj.url as string) ||
    (obj.link as string) ||
    (action.url as string) ||
    (action.link as string);
  if (typeof url === "string" && url.startsWith("http")) {
    return [
      {
        url,
        title: (obj.title as string) || (action.title as string) || url,
        snippet: (obj.snippet as string) || (action.snippet as string) || "",
      },
    ];
  }
  return [];
}

export function mergeSearchHits(
  existing: unknown[] | undefined,
  incoming: unknown[] | undefined
): unknown[] | undefined {
  if (!incoming?.length) return existing;
  if (!existing?.length) return incoming;
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const hit of [...existing, ...incoming]) {
    if (!hit || typeof hit !== "object") continue;
    const url =
      (hit as Record<string, unknown>).url ||
      (hit as Record<string, unknown>).link ||
      (hit as Record<string, unknown>).source_url;
    const key = typeof url === "string" ? url : JSON.stringify(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}
