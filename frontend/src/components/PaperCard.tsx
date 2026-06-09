import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
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
import FolderColorDot from "./FolderColorDot";
import MoveToFolderModal from "./MoveToFolderModal";
import PaperCover from "./PaperCover";

interface PaperCardProps {
  paper: PaperSummary;
  folders: FolderNode[];
  elapsedSeconds?: number;
  onChanged: () => void;
}

function CoverProcessingBadge({ paper }: { paper: PaperSummary }) {
  const st = getPaperStatusBadge(paper);
  return (
    <span className={`paper-card-status-badge ${st.className || ""}`}>
      <LoadingOutlined spin className="paper-card-status-icon" />
      <Tag color={st.color} bordered={false} className="paper-card-status-tag">
        {st.label}
      </Tag>
    </span>
  );
}

export default function PaperCard({
  paper,
  folders,
  elapsedSeconds = 0,
  onChanged,
}: PaperCardProps) {
  const navigate = useNavigate();
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const isProcessing = isPaperProcessing(paper);
  const pct = parseProgressPercent(paper);
  const folderCount = paper.folder_names?.length || 0;
  const noteProgress = paper.note_read_progress || 0;
  const showNoteProgress = paper.has_note && !isProcessing;
  const summary = paper.summary?.trim();
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
      <article
        className="paper-card"
        onClick={() => navigate(`/papers/${paper.id}`)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(`/papers/${paper.id}`);
        }}
      >
        <div className="paper-card-preview">
          <PaperCover paper={paper} folders={folders} variant="card" />
          {isProcessing ? (
            <div className="paper-card-preview-badges">
              <CoverProcessingBadge paper={paper} />
            </div>
          ) : null}
          {showNoteProgress && noteProgress >= 100 ? (
            <span className="paper-card-done-badge">已读完</span>
          ) : null}
          <div className="paper-card-top-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="paper-card-read-btn"
              onClick={() => navigate(`/papers/${paper.id}`)}
            >
              <BookOutlined />
              阅读
            </button>
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
              <button type="button" className="paper-card-more-btn" aria-label="更多操作">
                <EllipsisOutlined />
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="paper-card-body">
          <div className="paper-card-title-row">
            <h3 className="paper-card-title">{paper.title}</h3>
            {hasGeneratedNote(paper) && !isProcessing ? (
              <Tooltip title="已经生成笔记">
                <span
                  className="paper-card-note-done-icon"
                  aria-label="已经生成笔记"
                  onClick={(e) => e.stopPropagation()}
                >
                  <CheckCircleOutlined />
                </span>
              </Tooltip>
            ) : null}
          </div>
          <p className="paper-card-meta-line">{folderMetaLine(paper)}</p>
          {summary ? (
            <p className="paper-card-summary">
              <span className="paper-card-summary-icon">✨</span>
              {summary}
            </p>
          ) : null}
          {isProcessing ? (
            <div className="paper-card-progress" onClick={(e) => e.stopPropagation()}>
              <Progress percent={pct} size="small" showInfo={false} />
              {elapsedSeconds > 0 ? (
                <span className="paper-card-elapsed">{formatElapsed(elapsedSeconds)}</span>
              ) : null}
            </div>
          ) : (
            <>
              {showNoteProgress ? (
                <div className="paper-card-read-progress">
                  <div className="paper-card-read-progress-bar">
                    <div
                      className="paper-card-read-progress-fill"
                      style={{
                        width: `${noteProgress}%`,
                        background: noteProgressColor(noteProgress),
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="paper-card-footer-meta">
                <span>{formatPaperDate(paper.created_at)}</span>
                {showNoteProgress ? <span>👁 {noteProgress}%</span> : null}
                {!paper.has_note && !isProcessing ? <span>无笔记</span> : null}
                {folderCount > 0 ? (
                  <span>
                    <FolderOutlined /> {folderCount} 个文件夹
                  </span>
                ) : null}
                {paper.total_pages > 0 ? <span>📄 {paper.total_pages} 页</span> : null}
              </div>
              {(paper.folder_names || []).length > 0 ? (
                <div className="paper-card-tags">
                  {(paper.folder_names || []).slice(0, 2).map((name, idx) => {
                    const folderId = paper.folder_ids[idx];
                    return (
                      <Tag key={`${name}-${idx}`} className="paper-folder-tag">
                        {folderId != null ? (
                          <FolderColorDot folderId={folderId} folders={folders} />
                        ) : null}
                        {name}
                      </Tag>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>
      </article>

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
