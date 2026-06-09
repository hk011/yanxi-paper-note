import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Dropdown, Modal, Progress, Tag, Tooltip, message } from "antd";
import type { MenuProps } from "antd";
import type { FolderNode, PaperSummary } from "../api/client";
import { api } from "../api/client";
import {
  folderMetaLine,
  formatPaperDate,
  getPaperStatusBadge,
  hasGeneratedNote,
  isPaperProcessing,
  noteProgressColor,
  parseProgressPercent,
} from "../utils/paperCardHelpers";
import { formatElapsed } from "../utils/formatElapsed";
import EditPaperModal from "./EditPaperModal";
import MoveToFolderModal from "./MoveToFolderModal";
import PaperCover from "./PaperCover";

interface PaperListRowProps {
  paper: PaperSummary;
  folders: FolderNode[];
  elapsedSeconds?: number;
  onChanged: () => void;
}

export default function PaperListRow({
  paper,
  folders,
  elapsedSeconds = 0,
  onChanged,
}: PaperListRowProps) {
  const navigate = useNavigate();
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const st = getPaperStatusBadge(paper);
  const isProcessing = isPaperProcessing(paper);
  const pct = parseProgressPercent(paper);
  const summary = paper.summary?.trim();
  const showNoteProgress = paper.has_note && !isProcessing;
  const noteProgress = paper.note_read_progress || 0;
  const canRegenerateCard = paper.status === "parsed" || paper.status === "done";

  const handleRegenerateCard = async () => {
    try {
      await api.triggerPaperEnrichment(paper.id, true);
      message.success("已开始重新生成摘要与封面，请稍候");
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "重新生成失败");
    }
  };

  const handleDelete = async () => {
    try {
      await api.deletePaper(paper.id);
      message.success("论文已删除");
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const menuItems: MenuProps["items"] = [
    {
      key: "info",
      icon: <InfoCircleOutlined />,
      label: "信息",
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setInfoOpen(true);
      },
    },
    {
      key: "move",
      icon: <FileTextOutlined />,
      label: "移动至文件夹",
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setMoveOpen(true);
      },
    },
    {
      key: "edit",
      icon: <EditOutlined />,
      label: "编辑",
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setEditOpen(true);
      },
    },
    ...(canRegenerateCard
      ? [
          {
            key: "regenerate-card",
            icon: <ReloadOutlined />,
            label: "重新生成摘要与封面",
            onClick: ({ domEvent }: { domEvent: React.MouseEvent | React.KeyboardEvent }) => {
              domEvent.stopPropagation();
              void handleRegenerateCard();
            },
          } as NonNullable<MenuProps["items"]>[number],
        ]
      : []),
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: <span className="paper-card-delete-label">删除</span>,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        Modal.confirm({
          title: "确认删除",
          content:
            "删除后将永久移除该论文的 PDF、解析结果、解读笔记及生成图片，且无法恢复。",
          okText: "删除",
          cancelText: "取消",
          okType: "danger",
          onOk: handleDelete,
        });
      },
    },
  ];

  return (
    <>
      <tr
        className="paper-list-row"
        onClick={() => navigate(`/papers/${paper.id}`)}
      >
        <td>
          <div className="paper-list-main">
            <div className="paper-list-thumb">
              <PaperCover paper={paper} folders={folders} variant="list" />
            </div>
            <div className="paper-list-text">
              <strong>{paper.title}</strong>
              <span>{folderMetaLine(paper)}</span>
              {summary ? <span className="paper-list-summary">{summary}</span> : null}
              <span className="paper-list-date">{formatPaperDate(paper.created_at)}</span>
            </div>
          </div>
        </td>
        <td>
          {isProcessing ? (
            <Tag color={st.color}>{st.label}</Tag>
          ) : hasGeneratedNote(paper) ? (
            <Tooltip title="已经生成笔记">
              <span className="paper-card-note-done-icon" aria-label="已经生成笔记">
                <CheckCircleOutlined />
              </span>
            </Tooltip>
          ) : (
            <Tooltip title={paper.status === "failed" ? paper.error_message : undefined}>
              <Tag color={st.color}>{st.label}</Tag>
            </Tooltip>
          )}
        </td>
        <td>
          {isProcessing ? (
            <div className="paper-list-progress">
              <Progress percent={pct} size="small" showInfo={false} />
              {elapsedSeconds > 0 ? (
                <span>{formatElapsed(elapsedSeconds)}</span>
              ) : null}
            </div>
          ) : showNoteProgress ? (
            <div className="paper-list-read-progress">
              <div className="paper-card-read-progress-bar">
                <div
                  className="paper-card-read-progress-fill"
                  style={{
                    width: `${noteProgress}%`,
                    background: noteProgressColor(noteProgress),
                  }}
                />
              </div>
              <span>{noteProgress}%</span>
            </div>
          ) : (
            <span className="paper-list-folders">
              {(paper.folder_names || []).join("、") || "未归类"}
            </span>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="paper-list-actions">
            <button
              type="button"
              className="paper-card-read-btn paper-list-icon-btn"
              title="阅读"
              aria-label="阅读"
              onClick={() => navigate(`/papers/${paper.id}`)}
            >
              <BookOutlined />
            </button>
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
              <button
                type="button"
                className="paper-card-more-btn paper-list-icon-btn"
                aria-label="更多操作"
              >
                <EllipsisOutlined />
              </button>
            </Dropdown>
          </div>
        </td>
      </tr>

      <MoveToFolderModal
        open={moveOpen}
        currentFolderIds={paper.folder_ids}
        paperId={paper.id}
        onClose={() => setMoveOpen(false)}
        onSaved={onChanged}
      />
      <EditPaperModal
        open={editOpen}
        paper={paper}
        folders={folders}
        onClose={() => setEditOpen(false)}
        onSaved={onChanged}
      />
      <EditPaperModal
        open={infoOpen}
        paper={paper}
        folders={folders}
        readOnly
        onClose={() => setInfoOpen(false)}
        onSaved={() => {}}
      />
    </>
  );
}
