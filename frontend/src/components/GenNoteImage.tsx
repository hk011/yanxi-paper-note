import { DeleteOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Tooltip } from "antd";
import { memo, useEffect, useState } from "react";
import NoteImage from "./NoteImage";
import { isGenFigurePath, normalizeFigureRelPath } from "../utils/genFigure";

interface Props {
  rawSrc: string;
  paperId: number;
  eager: boolean;
  useDirectSrc?: boolean;
  onPreview: (src: string) => void;
  deletable?: boolean;
  deleting?: boolean;
  onDelete?: (imagePath: string) => void;
}

function GenNoteImage({
  rawSrc,
  paperId,
  eager,
  useDirectSrc,
  onPreview,
  deletable,
  deleting,
  onDelete,
}: Props) {
  const rel = normalizeFigureRelPath(rawSrc);
  const canDelete = deletable && isGenFigurePath(rawSrc) && onDelete;
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [rel]);

  if (broken && canDelete) {
    return (
      <span className="note-gen-figure-wrap note-gen-figure-wrap--broken">
        <span className="note-gen-figure-broken">
          <WarningOutlined /> 配图文件缺失（{rel}）
        </span>
        <Popconfirm
          title="移除失效引用？"
          description="将从笔记中删除该图片的 Markdown 引用。"
          okText="移除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleting }}
          onConfirm={() => onDelete(rel)}
        >
          <Button type="link" size="small" danger loading={deleting}>
            移除引用
          </Button>
        </Popconfirm>
      </span>
    );
  }

  return (
    <span className="note-gen-figure-wrap">
      <NoteImage
        rawSrc={rawSrc}
        paperId={paperId}
        eager={eager}
        useDirectSrc={useDirectSrc}
        className="md-img-clickable"
        onPreview={onPreview}
        onLoadError={() => setBroken(true)}
      />
      {canDelete ? (
        <Popconfirm
          title="删除配图？"
          description="将移除笔记中的引用，并在无其他引用时删除磁盘文件。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleting }}
          onConfirm={() => onDelete(rel)}
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

export default memo(
  GenNoteImage,
  (prev, next) =>
    prev.rawSrc === next.rawSrc &&
    prev.paperId === next.paperId &&
    prev.eager === next.eager &&
    prev.useDirectSrc === next.useDirectSrc &&
    prev.deletable === next.deletable &&
    prev.deleting === next.deleting
);
