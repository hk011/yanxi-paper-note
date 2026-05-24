import NoteImage from "./NoteImage";
import {
  diffMarkdownImages,
  type MarkdownImageRef,
} from "../utils/markdownImages";

interface Props {
  oldContent: string;
  newContent: string;
  paperId: number;
}

function ImageTile({
  image,
  paperId,
  label,
  tone,
}: {
  image: MarkdownImageRef;
  paperId: number;
  label: string;
  tone: "add" | "remove";
}) {
  return (
    <div className={`note-image-diff-tile note-image-diff-tile--${tone}`}>
      <span className="note-image-diff-tile-label">{label}</span>
      <div className="note-image-diff-tile-frame">
        <NoteImage
          rawSrc={image.src}
          paperId={paperId}
          eager
          alt={image.alt || "配图"}
          className="note-image-diff-thumb"
        />
      </div>
      {image.alt ? (
        <span className="note-image-diff-caption">{image.alt}</span>
      ) : null}
    </div>
  );
}

export default function NoteImageDiffStrip({ oldContent, newContent, paperId }: Props) {
  const { added, removed } = diffMarkdownImages(oldContent, newContent);
  if (added.length === 0 && removed.length === 0) return null;

  return (
    <div className="note-image-diff-strip">
      <div className="note-image-diff-strip-header">
        配图变更
        {added.length > 0 ? ` · 新增 ${added.length} 张` : ""}
        {removed.length > 0 ? ` · 移除 ${removed.length} 张` : ""}
      </div>
      <div className="note-image-diff-grid">
        {added.map((img) => (
          <ImageTile
            key={`add-${img.src}`}
            image={img}
            paperId={paperId}
            label="新增"
            tone="add"
          />
        ))}
        {removed.map((img) => (
          <ImageTile
            key={`rm-${img.src}`}
            image={img}
            paperId={paperId}
            label="移除"
            tone="remove"
          />
        ))}
      </div>
    </div>
  );
}
