import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { buildAuthenticatedUrl, buildPaperFileUrl } from "../api/client";

interface Props {
  content: string;
  paperId?: number;
  onImageClick?: (src: string) => void;
  className?: string;
}

function isAbsoluteUrl(src: string): boolean {
  if (/^(https?:|data:|blob:|\/api\/)/i.test(src)) return true;
  if (/^\/(assets|images)\//i.test(src)) return false;
  return src.startsWith("/");
}

function resolveImageUrl(raw: string, paperId?: number): string {
  if (!raw) return raw;
  const normalized = raw.replace(/^\/+/, "");
  if (raw.startsWith("/api/")) return buildAuthenticatedUrl(raw);
  if (paperId != null && !isAbsoluteUrl(raw)) {
    return buildPaperFileUrl(paperId, normalized);
  }
  return raw;
}

export default function MarkdownPreview({
  content,
  paperId,
  onImageClick,
  className,
}: Props) {
  return (
    <div className={className ? `markdown-body ${className}` : "markdown-body"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          table: ({ children, ...rest }) => (
            <div className="table-scroll-wrap">
              <table {...rest}>{children}</table>
            </div>
          ),
          img: ({ src, alt, ...rest }) => {
            const raw = typeof src === "string" ? src : "";
            const finalSrc = resolveImageUrl(raw, paperId);
            return (
              <img
                src={finalSrc}
                alt={alt ?? ""}
                loading="lazy"
                className="md-img-clickable"
                onClick={() => onImageClick?.(finalSrc)}
                {...rest}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
