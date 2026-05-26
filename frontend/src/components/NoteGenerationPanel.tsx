import { useEffect, useMemo, useState } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import type { NoteSectionDef } from "../constants/noteSections";
import type {
  NotePipelinePhase,
  SectionRunStatus,
  TimelineItem,
} from "../types/events";
import SectionProgressPanel from "./SectionProgressPanel";
import ThoughtTimeline from "./ThoughtTimeline";

interface Props {
  active: boolean;
  pipelinePhase: NotePipelinePhase;
  outlineStatus: SectionRunStatus;
  finalStatus: SectionRunStatus;
  sections: NoteSectionDef[];
  sectionProgress: Record<string, SectionRunStatus>;
  sectionTimelines: Record<string, TimelineItem[]>;
  paperId: number;
  modelLabel?: string;
}

function countTimelineSteps(sectionTimelines: Record<string, TimelineItem[]>) {
  return Object.values(sectionTimelines).reduce((sum, items) => sum + items.length, 0);
}

export function hasNoteGenerationTrace(
  outlineStatus: SectionRunStatus,
  finalStatus: SectionRunStatus,
  sectionProgress: Record<string, SectionRunStatus>,
  sectionTimelines: Record<string, TimelineItem[]>
) {
  return (
    outlineStatus !== "pending" ||
    finalStatus !== "pending" ||
    Object.values(sectionProgress).some((status) => status !== "pending") ||
    Object.values(sectionTimelines).some((items) => items.length > 0)
  );
}

export default function NoteGenerationPanel({
  active,
  pipelinePhase,
  outlineStatus,
  finalStatus,
  sections,
  sectionProgress,
  sectionTimelines,
  paperId,
  modelLabel,
}: Props) {
  const [open, setOpen] = useState(active);

  const hasTrace = useMemo(
    () =>
      hasNoteGenerationTrace(
        outlineStatus,
        finalStatus,
        sectionProgress,
        sectionTimelines
      ),
    [outlineStatus, finalStatus, sectionProgress, sectionTimelines]
  );

  const totalSteps = useMemo(
    () => countTimelineSteps(sectionTimelines),
    [sectionTimelines]
  );

  const doneSectionCount = useMemo(
    () => sections.filter((section) => sectionProgress[section.id] === "done").length,
    [sections, sectionProgress]
  );

  const timelineGroups = useMemo(() => {
    const groups: { key: string; label: string; items: TimelineItem[]; running: boolean }[] =
      [];

    const outlineItems = sectionTimelines._outline || [];
    if (outlineItems.length > 0) {
      groups.push({
        key: "_outline",
        label: "解析大纲",
        items: outlineItems,
        running: active && outlineStatus === "running",
      });
    }

    for (const section of sections) {
      const items = sectionTimelines[section.id] || [];
      if (items.length === 0) continue;
      groups.push({
        key: section.id,
        label: section.title,
        items,
        running: active && sectionProgress[section.id] === "running",
      });
    }

    const finalItems = sectionTimelines._final || [];
    if (finalItems.length > 0) {
      groups.push({
        key: "_final",
        label: "综合生成最终笔记",
        items: finalItems,
        running: active && finalStatus === "running",
      });
    }

    return groups;
  }, [
    active,
    finalStatus,
    outlineStatus,
    sectionProgress,
    sectionTimelines,
    sections,
  ]);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  useEffect(() => {
    if (!active && finalStatus === "done") {
      setOpen(false);
    }
  }, [active, finalStatus]);

  if (!hasTrace) return null;

  const summaryText = active
    ? pipelinePhase === "outline"
      ? "笔记生成中 · 正在解析大纲"
      : pipelinePhase === "final"
        ? "笔记生成中 · 正在综合生成最终笔记"
        : `笔记生成中 · 章节草稿 ${doneSectionCount}/${sections.length}`
    : totalSteps > 0
      ? `笔记生成过程 · 已完成 · 大纲 + ${sections.length} 章并行 + 综合重写 · ${totalSteps} 步`
      : `笔记生成过程 · 已完成 · 大纲 + ${sections.length} 章并行 + 综合重写（详细步骤未保存）`;

  return (
    <div className={`note-generation-panel${open ? " is-open" : ""}${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="note-generation-panel-bar"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="note-generation-panel-bar-label">{summaryText}</span>
        {modelLabel ? (
          <span className="note-generation-model-tag">{modelLabel}</span>
        ) : null}
        {open ? <DownOutlined /> : <RightOutlined />}
      </button>

      {open && (
        <div className="note-generation-panel-body">
          <SectionProgressPanel
            active={active}
            phase={pipelinePhase}
            outlineStatus={outlineStatus}
            finalStatus={finalStatus}
            sections={sections}
            sectionProgress={sectionProgress}
          />
          {timelineGroups.length > 0 && (
            <div className="note-generation-trace-list">
              {timelineGroups.map((group) => (
                <div key={group.key} className="note-generation-trace-group">
                  <div className="note-generation-trace-group-label">
                    {group.label}
                    <span className="note-generation-trace-group-meta">
                      {group.items.length} 步
                    </span>
                  </div>
                  <ThoughtTimeline
                    items={group.items}
                    active={group.running}
                    embedded
                    paperId={paperId}
                    label={group.label}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
