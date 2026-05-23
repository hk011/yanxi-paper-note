import { useEffect, useMemo, useState } from "react";
import { Modal, Segmented, Spin } from "antd";
import PdfViewer from "./PdfViewer";
import MarkdownPreview from "./MarkdownPreview";

export type SourceViewMode = "compare" | "pdf" | "markdown";
type MdMode = "preview" | "source";

interface Props {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  markdown: string;
  paperId: number;
  hasMarkdown: boolean;
  onLoadMarkdown: () => Promise<string>;
}

const viewOptions = [
  { label: "对比", value: "compare" },
  { label: "仅原文", value: "pdf" },
  { label: "仅 Markdown", value: "markdown" },
];

const mdModeOptions = [
  { label: "预览", value: "preview" },
  { label: "源码", value: "source" },
];

export default function DocSourceModal({
  open,
  onClose,
  pdfUrl,
  markdown,
  paperId,
  hasMarkdown,
  onLoadMarkdown,
}: Props) {
  const [viewMode, setViewMode] = useState<SourceViewMode>("compare");
  const [mdMode, setMdMode] = useState<MdMode>("preview");
  const [loadingMd, setLoadingMd] = useState(false);
  const [mdContent, setMdContent] = useState(markdown);

  useEffect(() => {
    if (markdown) setMdContent(markdown);
  }, [markdown]);

  useEffect(() => {
    if (!open) return;
    if (!hasMarkdown) {
      setViewMode("pdf");
      return;
    }
    if (mdContent) return;
    setLoadingMd(true);
    onLoadMarkdown()
      .then(setMdContent)
      .finally(() => setLoadingMd(false));
  }, [open, hasMarkdown, mdContent, onLoadMarkdown]);

  const showPdf = viewMode === "compare" || viewMode === "pdf";
  const showMd = viewMode === "compare" || viewMode === "markdown";

  const mdPanel = useMemo(() => {
    if (loadingMd) {
      return (
        <div className="doc-source-loading">
          <Spin />
        </div>
      );
    }
    if (!mdContent) {
      return <div className="doc-source-empty">暂无解析 Markdown</div>;
    }
    if (mdMode === "source") {
      return <pre className="markdown-source">{mdContent}</pre>;
    }
    return <MarkdownPreview content={mdContent} paperId={paperId} />;
  }, [loadingMd, mdContent, mdMode, paperId]);

  return (
    <Modal
      open={open}
      title={null}
      footer={null}
      width="90vw"
      centered
      destroyOnClose
      className="doc-source-modal"
      onCancel={onClose}
    >
      <div className="doc-source-modal-toolbar">
        <Segmented
          size="small"
          value={viewMode}
          onChange={(v) => setViewMode(v as SourceViewMode)}
          options={
            hasMarkdown
              ? viewOptions
              : viewOptions.map((o) => ({
                  ...o,
                  disabled: o.value !== "pdf",
                }))
          }
        />
        {showMd && hasMarkdown && (
          <Segmented
            size="small"
            value={mdMode}
            onChange={(v) => setMdMode(v as MdMode)}
            options={mdModeOptions}
            className="doc-source-md-mode"
          />
        )}
      </div>
      <div
        className={`doc-source-body doc-source-body--${viewMode}${
          !hasMarkdown ? " doc-source-body--pdf-only" : ""
        }`}
      >
        {showPdf && (
          <div className="doc-source-pane">
            <div className="doc-source-pane-label">原文 PDF</div>
            <div className="doc-source-pane-content">
              <PdfViewer url={pdfUrl} />
            </div>
          </div>
        )}
        {showMd && (
          <div className="doc-source-pane">
            <div className="doc-source-pane-label">解析 Markdown</div>
            <div className="doc-source-pane-content">{mdPanel}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
