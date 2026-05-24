import { DeleteOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Tooltip } from "antd";
import NoteImage from "./NoteImage";
import { isGenFigurePath, normalizeFigureRelPath } from "../utils/genFigure";

interface Props {
  rawSrc: string;
  paperId: number;
  eager: boolean;
  onPreview: (src: string) => void;
  deletable?: boolean;
  deleting?: boolean;
  onDelete?: (imagePath: string) => void;
}

export default function GenNoteImage({
  rawSrc,
  paperId,
  eager,
  onPreview,
  deletable,
  deleting,
  onDelete,
}: Props) {
  const canDelete = deletable && isGenFigurePath(rawSrc) && onDelete;

  return (
    <span className="note-gen-figure-wrap">
      <NoteImage
        rawSrc={rawSrc}
        paperId={paperId}
        eager={eager}
        className="md-img-clickable"
        onPreview={onPreview}
      />
      {canDelete ? (
        <Popconfirm
          title="删除配图？"
          description="将移除笔记中的引用，并在无其他引用时删除磁盘文件。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleting }}
          onConfirm={() => onDelete(normalizeFigureRelPath(rawSrc))}
        >
          <Tooltip title="删除配图">
            <Button
              type="text"
              size="small"
              danger
              className="note-gen-figure-delete-btn"
              icon={<DeleteOutlined />}
              loading={deleting}
              onClick={(e) => e.stopPropagation()}
            />
          </Tooltip>
        </Popconfirm>
      ) : null}
    </span>
  );
}
