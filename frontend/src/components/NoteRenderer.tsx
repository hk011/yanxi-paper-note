import { Component, useCallback, useMemo, useState, type ReactNode } from "react";
import { Modal } from "antd";
import { XMarkdown } from "@ant-design/x-markdown";
import Latex from "@ant-design/x-markdown/plugins/Latex";
import "@ant-design/x-markdown/es/XMarkdown/index.css";
import "katex/dist/katex.min.css";
import MarkdownPreview from "./MarkdownPreview";
import GenNoteImage from "./GenNoteImage";
import NoteSectionHeading from "./NoteSectionHeading";
import { normalizeFigureRelPath } from "../utils/genFigure";

interface Props {
  content: string;
  paperId: number;
  streaming?: boolean;
  sectionActions?: boolean;
  onAddSectionFigure?: (heading: string) => void;
  onRefineSection?: (heading: string) => void;
  sectionFigureLoadingHeading?: string | null;
  onDeleteFigure?: (imagePath: string) => void | Promise<void>;
  deletingFigurePath?: string | null;
}

const MARKDOWN_CONFIG = { extensions: Latex() };

const STREAMING_CONFIG = {
  hasNextChunk: true as const,
  enableAnimation: false as const,
  tail: { content: "▋" },
  incompleteMarkdownComponentMap: {
    link: "incomplete-link",
    image: "incomplete-image",
    table: "incomplete-table",
  },
};

function decodeStreamRaw(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function TableWrapper(props: Record<string, unknown>) {
  return (
    <div className="table-scroll-wrap">
      <table {...props} />
    </div>
  );
}

function IncompleteLink(props: Record<string, unknown>) {
  const pending = decodeStreamRaw(props["data-raw"]);
  return (
    <span className="xmd-incomplete xmd-incomplete--link" aria-busy="true">
      {pending || "链接输入中…"}
    </span>
  );
}

function IncompleteImage(_props: Record<string, unknown>) {
  return (
    <span className="xmd-incomplete xmd-incomplete--image" aria-busy="true">
      <span className="xmd-incomplete__block" />
    </span>
  );
}

function IncompleteTable(props: Record<string, unknown>) {
  const pending = decodeStreamRaw(props["data-raw"]);
  const rows = pending ? pending.split("\n").filter(Boolean).length : 1;
  return (
    <div className="xmd-incomplete xmd-incomplete--table table-scroll-wrap" aria-busy="true">
      <div
        className="xmd-incomplete__table-grid"
        style={{ gridTemplateRows: `repeat(${Math.min(rows + 1, 4)}, 2rem)` }}
      />
    </div>
  );
}

const STATIC_COMPONENTS = {
  table: TableWrapper,
  "incomplete-link": IncompleteLink,
  "incomplete-image": IncompleteImage,
  "incomplete-table": IncompleteTable,
};

class MarkdownErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export default function NoteRenderer({
  content,
  paperId,
  streaming,
  sectionActions,
  onAddSectionFigure,
  onRefineSection,
  sectionFigureLoadingHeading,
  onDeleteFigure,
  deletingFigurePath,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const handlePreview = useCallback((src: string) => setPreview(src), []);

  const renderImage = useCallback(
    (props: Record<string, unknown>) => {
      const raw = typeof props.src === "string" ? props.src : "";
      if (!raw) return null;
      const rel = normalizeFigureRelPath(raw);
      return (
        <GenNoteImage
          rawSrc={raw}
          paperId={paperId}
          eager
          useDirectSrc
          onPreview={handlePreview}
          deletable={sectionActions && !streaming}
          deleting={
            deletingFigurePath != null &&
            normalizeFigureRelPath(deletingFigurePath) === rel
          }
          onDelete={onDeleteFigure}
        />
      );
    },
    [paperId, streaming, handlePreview, sectionActions, onDeleteFigure, deletingFigurePath]
  );

  const makeHeading = useCallback(
    (level: 2 | 3) =>
      function SectionHeadingComponent(props: Record<string, unknown>) {
        return (
          <NoteSectionHeading
            level={level}
            className={typeof props.className === "string" ? props.className : undefined}
            id={typeof props.id === "string" ? props.id : undefined}
            showActions={sectionActions}
            onAddFigure={onAddSectionFigure}
            onRefineSection={onRefineSection}
            loadingHeading={sectionFigureLoadingHeading}
          >
            {props.children as ReactNode}
          </NoteSectionHeading>
        );
      },
    [sectionActions, onAddSectionFigure, onRefineSection, sectionFigureLoadingHeading]
  );

  const components = useMemo(
    () => ({
      ...STATIC_COMPONENTS,
      img: renderImage,
      h2: makeHeading(2),
      h3: makeHeading(3),
    }),
    [renderImage, makeHeading]
  );

  return (
    <div className={`note-renderer${streaming ? " note-renderer--streaming" : ""}`}>
      <MarkdownErrorBoundary
        resetKey={streaming ? "streaming" : "done"}
        fallback={
          <MarkdownPreview
            content={content}
            paperId={paperId}
            onImageClick={handlePreview}
          />
        }
      >
        <XMarkdown
          content={content}
          rootClassName="markdown-body"
          openLinksInNewTab
          config={MARKDOWN_CONFIG}
          streaming={streaming ? STREAMING_CONFIG : undefined}
          components={components}
        />
      </MarkdownErrorBoundary>
      <Modal
        open={!!preview}
        footer={null}
        onCancel={() => setPreview(null)}
        width="80vw"
        centered
        destroyOnClose
      >
        {preview && (
          <img src={preview} alt="预览" style={{ width: "100%", borderRadius: 8 }} />
        )}
      </Modal>
    </div>
  );
}
