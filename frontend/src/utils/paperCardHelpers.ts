import type { PaperSummary } from "../api/client";

export function formatPaperDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function noteProgressColor(progress: number): string {
  if (progress >= 70) return "#10b981";
  if (progress >= 30) return "#f59e0b";
  return "#ef4444";
}

export function isPaperProcessing(paper: PaperSummary): boolean {
  return (
    paper.status === "parsing" ||
    paper.status === "uploading" ||
    paper.status === "noting"
  );
}

export function hasGeneratedNote(paper: PaperSummary): boolean {
  return paper.has_note || paper.status === "done";
}

export function parseProgressPercent(paper: PaperSummary): number {
  if (paper.total_pages > 0 && paper.parsed_pages > 0) {
    return Math.round((paper.parsed_pages / paper.total_pages) * 100);
  }
  if (paper.status === "parsed" || paper.status === "done") return 100;
  return 0;
}

export type PaperStatusBadge = {
  color: string;
  label: string;
  className?: string;
};

export function getPaperStatusBadge(paper: PaperSummary): PaperStatusBadge {
  if (isPaperProcessing(paper)) {
    const map: Record<string, PaperStatusBadge> = {
      uploading: { color: "default", label: "上传中", className: "paper-status--uploading" },
      parsing: { color: "processing", label: "解析中", className: "paper-status--parsing" },
      noting: { color: "processing", label: "生成笔记", className: "paper-status--noting" },
    };
    return map[paper.status] || { color: "processing", label: paper.status };
  }
  if (paper.status === "failed") {
    return { color: "error", label: "失败", className: "paper-status--failed" };
  }
  if (paper.has_note || paper.status === "done") {
    return { color: "success", label: "已生成笔记", className: "paper-status--note" };
  }
  if (paper.status === "parsed") {
    return { color: "blue", label: "已解析", className: "paper-status--parsed" };
  }
  return { color: "default", label: paper.status };
}

export function folderMetaLine(paper: PaperSummary): string {
  const folders = paper.folder_names?.filter(Boolean) || [];
  const folderPart =
    folders.length > 0 ? folders.slice(0, 2).join("、") : "未归类";
  const author = paper.author?.trim() || "未填写作者";
  return `${folderPart} · ${author}`;
}
