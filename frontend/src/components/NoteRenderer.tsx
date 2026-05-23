import { Component, memo, type ReactNode, useCallback, useState } from "react";
import { Modal } from "antd";
import { XMarkdown } from "@ant-design/x-markdown";
import Latex from "@ant-design/x-markdown/plugins/Latex";
import "@ant-design/x-markdown/es/XMarkdown/index.css";
import "katex/dist/katex.min.css";
import MarkdownPreview from "./MarkdownPreview";
import NoteImage from "./NoteImage";

interface Props {
  content: string;
  paperId: number;
  streaming?: boolean;
}

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

const NoteImageBlock = memo(function NoteImageBlock({
  rawSrc,
  paperId,
  eager,
  onPreview,
}: {
  rawSrc: string;
  paperId: number;
  eager: boolean;
  onPreview: (src: string) => void;
}) {
  return (
    <NoteImage
      rawSrc={rawSrc}
      paperId={paperId}
      eager={eager}
      className="md-img-clickable"
      onPreview={onPreview}
    />
  );
});

export default function NoteRenderer({ content, paperId, streaming }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const handlePreview = useCallback((src: string) => setPreview(src), []);

  const renderImage = useCallback(
    (props: Record<string, unknown>) => {
      const raw = typeof props.src === "string" ? props.src : "";
      if (!raw) return null;
      return (
        <NoteImageBlock
          rawSrc={raw}
          paperId={paperId}
          eager={!streaming}
          onPreview={handlePreview}
        />
      );
    },
    [paperId, streaming, handlePreview]
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
          config={{ extensions: Latex() }}
          streaming={
            streaming
              ? {
                  hasNextChunk: true,
                  enableAnimation: false,
                  tail: { content: "▋" },
                }
              : undefined
          }
          components={{ img: renderImage }}
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
