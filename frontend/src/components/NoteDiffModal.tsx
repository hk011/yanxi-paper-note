import { Button, Modal, Segmented, Spin, Typography } from "antd";
import { CheckOutlined, CloseOutlined, UndoOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import MarkdownPreview from "./MarkdownPreview";
import {
  applyHunkDecisions,
  computeLineDiff,
  diffStats,
  groupDiffIntoHunks,
  hunkDecisionSummary,
  type DiffHunk,
  type HunkDecision,
} from "../utils/noteDiff";

const { Text } = Typography;

type ViewMode = "review" | "preview";

interface Props {
  open: boolean;
  loading?: boolean;
  oldContent: string;
  newContent: string;
  paperId: number;
  refineModel?: string;
  applying?: boolean;
  title?: string;
  applyLabel?: string;
  loadingHint?: string;
  onApply: (mergedContent: string) => void;
  onCancel: () => void;
}

function HunkCard({
  hunk,
  index,
  total,
  decision,
  onDecision,
}: {
  hunk: DiffHunk;
  index: number;
  total: number;
  decision: HunkDecision;
  onDecision: (id: string, d: HunkDecision) => void;
}) {
  const statusLabel =
    decision === "accept"
      ? "已接受"
      : decision === "reject"
        ? "已保留原版"
        : "待处理";

  return (
    <div
      className={`note-diff-hunk${
        decision === "accept"
          ? " note-diff-hunk--accept"
          : decision === "reject"
            ? " note-diff-hunk--reject"
            : ""
      }`}
    >
      <div className="note-diff-hunk-header">
        <span className="note-diff-hunk-title">
          修改块 {index + 1}/{total}
        </span>
        <span className="note-diff-hunk-meta">
          {hunk.removeCount > 0 && `删除 ${hunk.removeCount} 行`}
          {hunk.removeCount > 0 && hunk.addCount > 0 && " · "}
          {hunk.addCount > 0 && `新增 ${hunk.addCount} 行`}
        </span>
        <span className={`note-diff-hunk-status note-diff-hunk-status--${decision}`}>
          {statusLabel}
        </span>
      </div>

      <div className="note-diff-hunk-body">
        {hunk.lines.map((line, idx) => (
          <div
            key={`${hunk.id}-${idx}`}
            className={`note-diff-line note-diff-line--${line.kind}`}
          >
            <span className="note-diff-gutter">
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
            </span>
            <span className="note-diff-text">{line.text || " "}</span>
          </div>
        ))}
      </div>

      <div className="note-diff-hunk-actions">
        {decision === "pending" ? (
          <>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => onDecision(hunk.id, "reject")}
            >
              保留原版
            </Button>
            <Button
              size="small"
              type="primary"
              className="note-diff-btn-accept"
              icon={<CheckOutlined />}
              onClick={() => onDecision(hunk.id, "accept")}
            >
              接受修改
            </Button>
          </>
        ) : (
          <Button
            size="small"
            icon={<UndoOutlined />}
            onClick={() => onDecision(hunk.id, "pending")}
          >
            放弃
          </Button>
        )}
      </div>
    </div>
  );
}

export default function NoteDiffModal({
  open,
  loading,
  oldContent,
  newContent,
  paperId,
  refineModel,
  applying,
  title = "笔记融合预览",
  applyLabel = "应用融合结果",
  loadingHint = "正在生成融合后的笔记…",
  onApply,
  onCancel,
}: Props) {
  const [view, setView] = useState<ViewMode>("review");
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({});

  const diffLines = useMemo(
    () => computeLineDiff(oldContent, newContent),
    [oldContent, newContent]
  );
  const hunks = useMemo(() => groupDiffIntoHunks(diffLines), [diffLines]);
  const stats = useMemo(() => diffStats(diffLines), [diffLines]);
  const summary = useMemo(
    () => hunkDecisionSummary(hunks, decisions),
    [hunks, decisions]
  );

  const mergedPreview = useMemo(
    () => applyHunkDecisions(diffLines, decisions, "accept"),
    [diffLines, decisions]
  );

  useEffect(() => {
    if (!open) return;
    setView("review");
    const initial: Record<string, HunkDecision> = {};
    for (const h of groupDiffIntoHunks(computeLineDiff(oldContent, newContent))) {
      initial[h.id] = "pending";
    }
    setDecisions(initial);
  }, [open, oldContent, newContent]);

  const setHunkDecision = useCallback((id: string, d: HunkDecision) => {
    setDecisions((prev) => ({ ...prev, [id]: d }));
  }, []);

  const acceptAll = () => {
    const next: Record<string, HunkDecision> = {};
    for (const h of hunks) next[h.id] = "accept";
    setDecisions(next);
  };

  const rejectAll = () => {
    const next: Record<string, HunkDecision> = {};
    for (const h of hunks) next[h.id] = "reject";
    setDecisions(next);
  };

  const handleApply = () => {
    const merged = applyHunkDecisions(diffLines, decisions, "accept");
    onApply(merged);
  };

  const noChanges = !loading && hunks.length === 0 && oldContent === newContent;

  return (
    <Modal
      title={title}
      open={open}
      width={960}
      zIndex={1200}
      centered
      destroyOnHidden
      className="note-diff-modal"
      styles={{
        body: {
          height: "min(72vh, 720px)",
          maxHeight: "min(72vh, 720px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          paddingBottom: 16,
        },
      }}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={applying}>
          放弃
        </Button>,
        <Button
          key="apply"
          type="primary"
          loading={applying}
          disabled={loading || !newContent.trim() || noChanges}
          onClick={handleApply}
        >
          {summary.pending > 0
            ? `应用（未决 ${summary.pending} 块将按「接受」处理）`
            : applyLabel}
        </Button>,
      ]}
    >
      <div className="note-diff-modal-inner">
        <div className="note-diff-toolbar">
          <div className="note-diff-toolbar-summary">
            {refineModel ? (
              <span className="note-diff-model-tag">模型：{refineModel}</span>
            ) : null}
            <Text type="secondary">
            {loading
              ? loadingHint
              : hunks.length > 0
                ? `共 ${hunks.length} 处修改 · +${stats.added}/−${stats.removed} 行 · 已接受 ${summary.accept} · 保留原版 ${summary.reject}`
                : `新增 ${stats.added} 行 · 删除 ${stats.removed} 行`}
            </Text>
          </div>
          <div className="note-diff-toolbar-right">
            {!loading && hunks.length > 0 && view === "review" && (
              <>
                <Button size="small" onClick={acceptAll}>
                  全部接受
                </Button>
                <Button size="small" onClick={rejectAll}>
                  全部保留原版
                </Button>
              </>
            )}
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as ViewMode)}
              options={[
                { label: "逐块审阅", value: "review" },
                { label: "预览对比", value: "preview" },
              ]}
            />
          </div>
        </div>

        {loading ? (
          <div className="note-diff-loading">
            <Spin tip="模型正在重写笔记…" />
          </div>
        ) : view === "review" ? (
          <div className="note-diff-review-scroll">
            {hunks.length === 0 ? (
              <div className="note-diff-empty">
                {stats.added === 0 && stats.removed === 0 ? (
                  <Text type="secondary">修改稿与当前笔记无差异</Text>
                ) : (
                  <pre className="note-diff-unified">
                    {diffLines.map((line, idx) => (
                      <div
                        key={idx}
                        className={`note-diff-line note-diff-line--${line.kind}`}
                      >
                        <span className="note-diff-gutter">
                          {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
                        </span>
                        <span className="note-diff-text">{line.text || " "}</span>
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            ) : (
              hunks.map((hunk, i) => (
                <HunkCard
                  key={hunk.id}
                  hunk={hunk}
                  index={i}
                  total={hunks.length}
                  decision={decisions[hunk.id] ?? "pending"}
                  onDecision={setHunkDecision}
                />
              ))
            )}
          </div>
        ) : (
          <div className="note-diff-preview-scroll">
            <div className="note-diff-split">
              <div className="note-diff-pane">
                <div className="note-diff-pane-label">当前版本（预览）</div>
                <div className="note-diff-pane-preview">
                  <MarkdownPreview content={oldContent} paperId={paperId} />
                </div>
              </div>
              <div className="note-diff-pane">
                <div className="note-diff-pane-label">合并后预览</div>
                <div className="note-diff-pane-preview">
                  <MarkdownPreview content={mergedPreview} paperId={paperId} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
