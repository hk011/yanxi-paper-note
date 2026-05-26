import { EditOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";

function extractPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractPlainText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractPlainText(props?.children);
  }
  return "";
}

interface SectionHeadingProps {
  level: 2 | 3;
  children?: ReactNode;
  className?: string;
  id?: string;
  onAddFigure?: (heading: string) => void;
  onRefineSection?: (heading: string) => void;
  loadingHeading?: string | null;
  showActions?: boolean;
}

export default function NoteSectionHeading({
  level,
  children,
  className,
  id,
  onAddFigure,
  onRefineSection,
  loadingHeading,
  showActions,
}: SectionHeadingProps) {
  const Tag = level === 2 ? "h2" : "h3";
  const title = extractPlainText(children).trim();
  const canAct = showActions && title;
  const figureLoading = loadingHeading != null && loadingHeading === title;

  return (
    <div className={`note-section-heading-row${canAct ? " note-section-heading-row--actions" : ""}`}>
      <Tag id={id} className={className ? `note-section-heading ${className}` : "note-section-heading"}>
        {children}
      </Tag>
      {canAct ? (
        <span className="note-section-heading-actions">
          {onAddFigure ? (
            <Tooltip
              title={
                level === 2
                  ? "为本章（含下属三级标题）生成配图并插入笔记"
                  : "为本小节生成通俗配图并插入笔记"
              }
            >
              <Button
                type="text"
                size="small"
                className="note-section-add-figure-btn"
                icon={<PictureOutlined />}
                loading={figureLoading}
                onClick={() => onAddFigure(title)}
              >
                添加配图
              </Button>
            </Tooltip>
          ) : null}
          {onRefineSection ? (
            <Tooltip
              title={
                level === 2
                  ? "按你的要求润色本章正文（含下属三级标题）"
                  : "按你的要求润色本小节正文"
              }
            >
              <Button
                type="text"
                size="small"
                className="note-section-refine-btn"
                icon={<EditOutlined />}
                disabled={figureLoading}
                onClick={() => onRefineSection(title)}
              >
                润色本节
              </Button>
            </Tooltip>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
