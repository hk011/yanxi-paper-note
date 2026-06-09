import type { FolderNode, PaperSummary } from "../api/client";
import { buildPaperCoverUrl } from "../api/client";
import { getPaperCoverTheme } from "../utils/folderColor";

interface PaperCoverProps {
  paper: PaperSummary;
  folders?: FolderNode[];
  variant?: "card" | "list";
}

export default function PaperCover({
  paper,
  folders,
  variant = "card",
}: PaperCoverProps) {
  const coverSrc = buildPaperCoverUrl(paper.cover_url);
  if (coverSrc && paper.cover_status === "done") {
    return (
      <div className={`paper-cover paper-cover--${variant} paper-cover--image`}>
        <img className="paper-cover-img" src={coverSrc} alt="" loading="lazy" />
        <div className="paper-cover-image-overlay" />
      </div>
    );
  }

  const theme = getPaperCoverTheme(paper, folders);
  const author = paper.author?.trim();

  return (
    <div
      className={`paper-cover paper-cover--${variant}`}
      style={{
        background: `linear-gradient(145deg, ${theme.from} 0%, ${theme.to} 100%)`,
        color: theme.text,
      }}
    >
      <p className="paper-cover-title">{paper.title}</p>
      {author ? <p className="paper-cover-author">{author}</p> : null}
    </div>
  );
}
