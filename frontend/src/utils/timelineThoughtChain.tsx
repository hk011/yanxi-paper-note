import type { ThoughtChainItemType } from "@ant-design/x";
import {
  BulbOutlined,
  PictureOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import ThoughtChainStepContent from "../components/ThoughtChainStepContent";
import type { TimelineItem } from "../types/events";

export function toolIconNode(tool: string) {
  if (tool === "web_search") return <SearchOutlined />;
  if (tool === "gen_figure") return <PictureOutlined />;
  return <BulbOutlined />;
}

export function toolTitleText(
  tool: string,
  input?: Record<string, unknown>,
  content?: string
) {
  if (tool === "web_search") {
    const q =
      (input?.query as string) ||
      (content?.startsWith("搜索：") ? content.slice(3) : "");
    return q ? `联网搜索：${q}` : "联网搜索";
  }
  if (tool === "gen_figure") {
    const title =
      (input?.title as string) || (input?.prompt as string)?.slice(0, 24);
    return title ? `生成配图：${title}` : "生成配图";
  }
  return tool;
}

function thinkingStepLabel(index: number, total: number) {
  if (total <= 1) return "";
  return ` · 第 ${index} 步`;
}

function thinkingTitle(item: TimelineItem, index: number, total: number, active: boolean) {
  const suffix = thinkingStepLabel(index, total);
  if (active && item.status === "pending") return `深度思考${suffix}`;
  return `思考过程${suffix}`;
}

function toolDescription(item: TimelineItem, active: boolean) {
  const isPending = item.status === "pending" && active;
  if (item.tool === "web_search") {
    const q =
      (item.input?.query as string) ||
      (item.content?.startsWith("搜索：") ? item.content.slice(3) : "");
    if (isPending) return q ? `正在检索「${q}」` : "正在检索…";
    const hitCount = item.hits?.length ?? 0;
    return hitCount > 0 ? `共 ${hitCount} 条来源` : q ? `检索完成：${q}` : "检索完成";
  }
  if (item.tool === "gen_figure") {
    return isPending ? "正在生成说明图…" : "配图已生成";
  }
  if (isPending) return "执行中…";
  return "已完成";
}

function hasExpandableContent(item: TimelineItem, active: boolean): boolean {
  if (active && item.status === "pending") {
    if (item.kind === "thinking") return Boolean((item.content || "").trim());
    // 进行中的工具不展开详情，避免搜索/生图结果在结束时一次性刷出
    return false;
  }
  if (item.kind === "thinking") return Boolean((item.content || "").trim());
  if (item.hits?.length) return true;
  if (item.output != null) return true;
  return Boolean((item.content || "").trim());
}

export function mapTimelineStatus(
  item: TimelineItem,
  active: boolean
): ThoughtChainItemType["status"] {
  if (item.status === "pending") return active ? "loading" : "success";
  if (item.status === "error") return "error";
  return "success";
}

export function mapTimelineToThoughtChainItems(
  items: TimelineItem[],
  active: boolean,
  paperId: number
): ThoughtChainItemType[] {
  const thinkingTotal = items.filter((i) => i.kind === "thinking").length;
  let thinkingIndex = 0;

  return items.map((item) => {
    if (item.kind === "thinking") {
      thinkingIndex += 1;
      const isPending = item.status === "pending" && active;
      const text = (item.content || "").trim();
      const preview =
        text.length > 56 ? `${text.slice(0, 56)}…` : text || undefined;

      return {
        key: item.key,
        title: thinkingTitle(item, thinkingIndex, thinkingTotal, active),
        description: isPending && !preview ? "思考中…" : preview,
        status: mapTimelineStatus(item, active),
        icon: <BulbOutlined />,
        blink: isPending && active,
        collapsible: hasExpandableContent(item, active),
        content: hasExpandableContent(item, active) ? (
          <ThoughtChainStepContent item={item} paperId={paperId} />
        ) : undefined,
      };
    }

    const isPending = item.status === "pending" && active;
    return {
      key: item.key,
      title: toolTitleText(item.tool || "tool", item.input, item.content),
      description: toolDescription(item, active),
      status: mapTimelineStatus(item, active),
      icon: toolIconNode(item.tool || ""),
      blink: isPending && active,
      collapsible: hasExpandableContent(item, active),
      content: hasExpandableContent(item, active) ? (
        <ThoughtChainStepContent item={item} paperId={paperId} />
      ) : undefined,
    };
  });
}

/** 流式进行中默认展开的节点 key */
export function defaultExpandedKeysForTimeline(
  items: TimelineItem[],
  active: boolean
): string[] {
  if (!active) return [];
  return items
    .filter((item) => {
      if (item.status !== "pending") return false;
      return hasExpandableContent(item, active) || item.kind === "thinking";
    })
    .map((item) => item.key);
}
