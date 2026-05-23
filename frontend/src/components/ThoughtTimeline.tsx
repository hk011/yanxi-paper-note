import { useEffect, useMemo, useState } from "react";
import { ThoughtChain } from "@ant-design/x";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import {
  defaultExpandedKeysForTimeline,
  mapTimelineToThoughtChainItems,
} from "../utils/timelineThoughtChain";
import type { TimelineItem } from "../types/events";

interface Props {
  items: TimelineItem[];
  active?: boolean;
  paperId: number;
  compact?: boolean;
  embedded?: boolean;
  label?: string;
}

export default function ThoughtTimeline({
  active = false,
  items,
  paperId,
  compact = false,
  embedded = false,
  label,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  /** 流式进行中：仅展示当前 pending 步骤，完成后自动从视图移除 */
  const visibleItems = useMemo(() => {
    if (!active) return items;
    return items.filter((item) => item.status === "pending");
  }, [items, active]);

  const chainItems = useMemo(
    () => mapTimelineToThoughtChainItems(visibleItems, active, paperId),
    [visibleItems, active, paperId]
  );

  useEffect(() => {
    if (active) {
      setPanelOpen(true);
      const pendingKeys = new Set(
        items.filter((i) => i.status === "pending").map((i) => i.key)
      );
      const autoKeys = defaultExpandedKeysForTimeline(items, true);
      setExpandedKeys(() => {
        const next = new Set<string>();
        for (const key of autoKeys) {
          if (pendingKeys.has(key)) next.add(key);
        }
        return Array.from(next);
      });
      return;
    }
    setPanelOpen(false);
    setExpandedKeys([]);
  }, [items, active]);

  if (!active && items.length === 0) return null;

  const chain =
    chainItems.length > 0 ? (
      <ThoughtChain
        items={chainItems}
        line="solid"
        expandedKeys={expandedKeys}
        onExpand={setExpandedKeys}
        rootClassName="thought-chain-native"
      />
    ) : null;

  if (active && visibleItems.length === 0) {
    if (compact) {
      return (
        <div className="thought-stream-block thought-stream-block--compact">
          <div className="thought-compact-bar thought-compact-bar--static">
            <span className="thought-compact-bar-label">思考中…</span>
          </div>
        </div>
      );
    }
    return (
      <div className="thought-timeline-panel thought-timeline-panel--active-only">
        <div className="thought-timeline-panel-header thought-timeline-panel-header--static">
          <span className="thought-timeline-panel-title">思考过程（进行中）</span>
        </div>
      </div>
    );
  }

  if (!chain) {
    if (!active) return null;
    return null;
  }

  if (embedded) {
    return (
      <div className="thought-timeline-native-wrap thought-timeline-native-wrap--embedded">
        {chain}
      </div>
    );
  }

  if (compact) {
    if (active) {
      return (
        <div className="thought-stream-block thought-stream-block--compact">
          <div className="thought-timeline-native-wrap thought-timeline-native-wrap--compact">
            {chain}
          </div>
        </div>
      );
    }

    const summary = `思考过程 · ${items.length} 步`;
    return (
      <div className="thought-stream-block thought-stream-block--compact">
        <button
          type="button"
          className="thought-compact-bar"
          onClick={() => setPanelOpen((v) => !v)}
        >
          <span className="thought-compact-bar-label">{summary}</span>
          {panelOpen ? <DownOutlined /> : <RightOutlined />}
        </button>
        {panelOpen && (
          <div className="thought-timeline-native-wrap thought-timeline-native-wrap--compact">
            {chain}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="thought-timeline-panel">
      <button
        type="button"
        className="thought-timeline-panel-header"
        onClick={() => setPanelOpen((v) => !v)}
      >
        <span className="thought-timeline-panel-title">
          {label
            ? active
              ? `${label}（进行中）`
              : label
            : active
              ? "思考过程（进行中）"
              : "思考过程"}
        </span>
        <span className="thought-timeline-panel-meta">{items.length} 步</span>
        {panelOpen ? <DownOutlined /> : <RightOutlined />}
      </button>

      {panelOpen && (
        <div className="thought-timeline-native-wrap">{chain}</div>
      )}
    </div>
  );
}
