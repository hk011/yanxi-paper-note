import type { TimelineItem } from "../types/events";
import {
  extractHitsFromToolOutput,
  mergeSearchHits,
} from "./searchHits";

function mergeHits(
  existing: unknown[] | undefined,
  incoming: unknown[] | undefined
) {
  return mergeSearchHits(existing, incoming);
}

function findToolItem(
  items: TimelineItem[],
  toolMap: Map<string, TimelineItem>,
  raw: Record<string, unknown>
) {
  const callId = String(raw.call_id || "");
  if (callId && toolMap.has(callId)) return toolMap.get(callId);
  const tool = String(raw.tool || "");
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const t = items[i];
    if (t.kind === "tool" && t.tool === tool && t.status === "pending") return t;
  }
  return undefined;
}

/** 从已落库的 assistant 消息还原 ThoughtChain 时间线 */
export function timelineFromAssistantMessage(
  messageId: number | string,
  msg: {
    reasoning_content?: string;
    tool_trace?: unknown[];
    had_tool_call?: boolean;
  }
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolMap = new Map<string, TimelineItem>();

  for (const raw of (msg.tool_trace || []) as Record<string, unknown>[]) {
    const type = String(raw.type || "");
    const callId = String(raw.call_id || "");
    const tool = String(raw.tool || "tool");
    const key = callId || `${tool}-${items.length}`;

    if (type === "tool_start") {
      const item: TimelineItem = {
        key,
        kind: "tool",
        status: "pending",
        tool,
        callId: callId || undefined,
        input: (raw.input as Record<string, unknown>) || undefined,
      };
      toolMap.set(key, item);
      if (callId) toolMap.set(callId, item);
      items.push(item);
      continue;
    }

    const target = findToolItem(items, toolMap, raw);
    if (!target) continue;

    if (type === "tool_delta" || type === "references") {
      const q = raw.query as string | undefined;
      if (q) {
        target.input = { ...(target.input || {}), query: q };
        target.content = `搜索：${q}`;
      }
      if (Array.isArray(raw.hits)) {
        target.hits = mergeHits(target.hits, raw.hits);
      }
      if (type === "references" && Array.isArray(raw.items)) {
        target.hits = mergeHits(target.hits, raw.items);
      }
      continue;
    }

    if (type === "tool_end") {
      target.status = raw.status === "error" ? "error" : "success";
      const q = raw.query as string | undefined;
      if (q) {
        target.input = { ...(target.input || {}), query: q };
        target.content = `搜索：${q}`;
      }
      if (Array.isArray(raw.hits)) {
        target.hits = mergeHits(target.hits, raw.hits);
      }
      if (raw.output != null) target.output = raw.output;
      target.hits = mergeHits(
        target.hits,
        extractHitsFromToolOutput(raw.output)
      );
    }
  }

  for (const item of items) {
    if (item.kind === "tool" && item.status === "pending") {
      item.status = "success";
    }
  }

  const reasoning = (msg.reasoning_content || "").trim();
  if (reasoning) {
    items.unshift({
      key: `thinking-${messageId}`,
      kind: "thinking",
      status: "success",
      content: reasoning,
    });
  }

  if (items.length === 0 && !msg.had_tool_call && !reasoning) {
    return [];
  }

  return items;
}
