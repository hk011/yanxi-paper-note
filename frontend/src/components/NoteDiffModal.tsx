import { Button, Modal, Segmented, Spin, Typography } from "antd";
import { CheckOutlined, CloseOutlined, UndoOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import NoteImage from "./NoteImage";
import NoteImageDiffStrip from "./NoteImageDiffStrip";
import NoteRenderer from "./NoteRenderer";
import {
  applyHunkDecisions,
  computeLineDiff,
  diffStats,
  groupDiffIntoHunks,
  hunkDecisionSummary,
  type DiffHunk,
  type HunkDecision,
} from "../utils/noteDiff";
import { diffMarkdownImages, parseImageLine } from "../utils/markdownImages";

const { Text } = Typography;

type ViewMode = "review" | "preview" | "images";

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
  variant?: "refine" | "note_edit";
  readOnly?: boolean;
  defaultHunkDecision?: HunkDecision;
  onApply: (mergedContent: string) => void;
  onCancel: () => void;
}

function DiffLineRow({
  line,
  paperId,
}: {
  line: { kind: string; text: string };
  paperId: number;
}) {
  const imageRef = parseImageLine(line.text);
  return (
    <div className={`note-diff-line note-diff-line--${line.kind}`}>
      <span className="note-diff-gutter">
        {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
      </span>
      <span className="note-diff-text">
        {imageRef ? (
          <span className="note-diff-image-row">
            <code className="note-diff-image-path">{line.text.trim()}</code>
            <NoteImage
              rawSrc={imageRef.src}
              paperId={paperId}
              eager
              alt={imageRef.alt || "配图"}
              className="note-diff-inline-thumb"
            />
          </span>
        ) : (
          line.text || " "
        )}
      </span>
    </div>
  );
}

function HunkCard({
  hunk,
  index,
  total,
  decision,
  paperId,
  onDecision,
}: {
  hunk: DiffHunk;
  index: number;
  total: number;
  decision: HunkDecision;
  paperId: number;
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
          <DiffLineRow key={`${hunk.id}-${idx}`} line={line} paperId={paperId} />
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
  variant = "refine",
  readOnly = false,
  defaultHunkDecision = "pending",
  onApply,
  onCancel,
}: Props) {
  const isNoteEdit = variant === "note_edit";
  const [view, setView] = useState<ViewMode>(
    readOnly && isNoteEdit ? "preview" : isNoteEdit ? "images" : "review"
  );
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
  const imageDiff = useMemo(
    () => diffMarkdownImages(oldContent, newContent),
    [oldContent, newContent]
  );
  const hasImageChanges =
    imageDiff.added.length > 0 || imageDiff.removed.length > 0;

  const mergedPreview = useMemo(
    () => applyHunkDecisions(diffLines, decisions, "accept"),
    [diffLines, decisions]
  );

  const viewOptions = useMemo(() => {
    const opts: { label: string; value: ViewMode }[] = [];
    if (isNoteEdit && hasImageChanges) {
      opts.push({ label: "配图对比", value: "images" });
    }
    opts.push({ label: "预览对比", value: "preview" });
    if (!readOnly && (!isNoteEdit || hunks.length > 0)) {
      opts.push({ label: "逐块审阅", value: "review" });
    }
    return opts;
  }, [isNoteEdit, hasImageChanges, hunks.length, readOnly]);

  useEffect(() => {
    if (!open) return;
    setView(
      readOnly && isNoteEdit
        ? "preview"
        : isNoteEdit && hasImageChanges
          ? "images"
          : isNoteEdit
            ? "preview"
            : "review"
    );
    const initial: Record<string, HunkDecision> = {};
    for (const h of groupDiffIntoHunks(computeLineDiff(oldContent, newContent))) {
      initial[h.id] = defaultHunkDecision;
    }
    setDecisions(initial);
  }, [open, oldContent, newContent, isNoteEdit, hasImageChanges, readOnly, defaultHunkDecision]);

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
      footer={
        readOnly
          ? [
              <Button key="close" type="primary" onClick={onCancel}>
                关闭
              </Button>,
            ]
          : [
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
              options={viewOptions}
            />
          </div>
        </div>

        {loading ? (
          <div className="note-diff-loading">
            <Spin tip="模型正在重写笔记…" />
          </div>
        ) : view === "images" ? (
          <div className="note-diff-images-scroll">
            <NoteImageDiffStrip
              oldContent={oldContent}
              newContent={mergedPreview}
              paperId={paperId}
            />
            {!hasImageChanges ? (
              <div className="note-diff-empty">
                <Text type="secondary">本次修改未涉及配图引用</Text>
              </div>
            ) : null}
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
                      <DiffLineRow key={idx} line={line} paperId={paperId} />
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
                  paperId={paperId}
                  onDecision={setHunkDecision}
                />
              ))
            )}
          </div>
        ) : (
          <div className="note-diff-preview-scroll">
            <div className="note-diff-split">
              <div className="note-diff-pane">
                <div className="note-diff-pane-label">当前版本</div>
                <div className="note-diff-pane-preview">
                  <NoteRenderer content={oldContent} paperId={paperId} />
                </div>
              </div>
              <div className="note-diff-pane">
                <div className="note-diff-pane-label">修改后预览</div>
                <div className="note-diff-pane-preview">
                  <NoteRenderer content={mergedPreview} paperId={paperId} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
