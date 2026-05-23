import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { Progress } from "antd";
import type { NotePipelinePhase, SectionRunStatus } from "../types/events";
import type { NoteSectionDef } from "../constants/noteSections";

interface Props {
  active?: boolean;
  phase: NotePipelinePhase;
  outlineStatus: SectionRunStatus;
  finalStatus: SectionRunStatus;
  sections: NoteSectionDef[];
  sectionProgress: Record<string, SectionRunStatus>;
}

function resolveStepStatus(
  status: SectionRunStatus,
  phaseActive: boolean
): SectionRunStatus {
  if (status === "done" || status === "error") return status;
  if (status === "running" || phaseActive) return "running";
  return "pending";
}

function statusIcon(status: SectionRunStatus) {
  switch (status) {
    case "running":
      return <LoadingOutlined spin className="section-progress-icon section-progress-icon--running" />;
    case "done":
      return <CheckCircleFilled className="section-progress-icon section-progress-icon--done" />;
    case "error":
      return <CloseCircleFilled className="section-progress-icon section-progress-icon--error" />;
    default:
      return <MinusCircleOutlined className="section-progress-icon section-progress-icon--pending" />;
  }
}

function statusLabel(status: SectionRunStatus) {
  switch (status) {
    case "running":
      return "进行中";
    case "done":
      return "已完成";
    case "error":
      return "失败";
    default:
      return "等待中";
  }
}

export default function SectionProgressPanel({
  active = false,
  phase,
  outlineStatus,
  finalStatus,
  sections,
  sectionProgress,
}: Props) {
  const doneCount = sections.filter((s) => sectionProgress[s.id] === "done").length;
  const draftPercent =
    sections.length > 0 ? Math.round((doneCount / sections.length) * 100) : 0;

  const outlineStepStatus = resolveStepStatus(
    outlineStatus,
    active && phase === "outline"
  );

  const finalStepStatus = resolveStepStatus(
    finalStatus,
    active && phase === "final"
  );

  return (
    <div className="section-progress-panel">
      <div className="section-progress-header">
        <span className="section-progress-title">笔记生成进度</span>
        {phase === "draft" && (
          <span className="section-progress-meta">
            章节草稿 {doneCount}/{sections.length}
          </span>
        )}
      </div>

      <div className="section-progress-steps">
        <div className={`section-progress-step is-${outlineStepStatus}`}>
          {statusIcon(outlineStepStatus)}
          <span className="section-progress-step-label">解析大纲</span>
          <span className="section-progress-step-status">
            {statusLabel(outlineStepStatus)}
          </span>
        </div>

        <div className={`section-progress-block is-${phase === "draft" ? "active" : ""}`}>
          <div className="section-progress-block-title">
            <span>章节草稿（并行）</span>
            {phase === "draft" && (
              <Progress
                percent={draftPercent}
                size="small"
                showInfo={false}
                className="section-progress-inline-bar"
              />
            )}
          </div>
          <div className="section-progress-grid">
            {sections.map((section) => {
              const st = sectionProgress[section.id] || "pending";
              return (
                <div key={section.id} className={`section-progress-item is-${st}`}>
                  {statusIcon(st)}
                  <span className="section-progress-item-title">{section.title}</span>
                  <span className="section-progress-item-status">{statusLabel(st)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`section-progress-step is-${finalStepStatus}`}>
          {statusIcon(finalStepStatus)}
          <span className="section-progress-step-label">综合生成最终笔记</span>
          <span className="section-progress-step-status">
            {statusLabel(finalStepStatus)}
          </span>
        </div>
      </div>
    </div>
  );
}
