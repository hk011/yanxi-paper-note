import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Empty,
  Popconfirm,
  Progress,
  Tag,
  Upload,
  message,
  Typography,
} from "antd";
import { DeleteOutlined, InboxOutlined } from "@ant-design/icons";
import { api, PaperSummary } from "../api/client";
import { formatElapsed } from "../utils/formatElapsed";
import WorkspaceShell from "../components/WorkspaceShell";

const { Dragger } = Upload;
const { Text } = Typography;

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  uploading: { color: "default", label: "上传中" },
  parsing: { color: "processing", label: "解析中" },
  parsed: { color: "success", label: "已解析" },
  noting: { color: "processing", label: "生成笔记" },
  done: { color: "success", label: "完成" },
  failed: { color: "error", label: "失败" },
};

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HomePage() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [elapsedMap, setElapsedMap] = useState<Record<number, number>>({});

  const hasParsing = papers.some(
    (p) => p.status === "parsing" || p.status === "uploading"
  );

  useEffect(() => {
    if (!hasParsing) return;
    const timer = setInterval(() => {
      setElapsedMap((prev) => {
        const next = { ...prev };
        for (const p of papers) {
          if (p.status === "parsing" || p.status === "uploading") {
            next[p.id] = (next[p.id] ?? p.parse_elapsed_seconds) + 1;
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasParsing, papers]);

  const load = useCallback(async () => {
    try {
      const list = await api.listPapers();
      setPapers(list);
      setElapsedMap((prev) => {
        const next = { ...prev };
        for (const p of list) {
          if (p.status === "parsing" || p.status === "uploading") {
            next[p.id] = Math.max(prev[p.id] ?? 0, p.parse_elapsed_seconds);
          } else {
            delete next[p.id];
          }
        }
        return next;
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    load();
    const intervalMs = hasParsing ? 3000 : 5000;
    const timer = setInterval(load, intervalMs);
    return () => clearInterval(timer);
  }, [load, hasParsing]);

  const handleDelete = async (paperId: number) => {
    try {
      await api.deletePaper(paperId);
      message.success("论文已删除");
      setPapers((prev) => prev.filter((p) => p.id !== paperId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const paper = await api.uploadPaper(file);
      message.success("上传成功，开始解析");
      navigate(`/papers/${paper.id}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
    return false;
  };

  return (
    <WorkspaceShell
      title="全部任务"
      subtitle="上传 PDF 论文，自动解析并生成解读笔记。"
      papers={papers.map((p) => ({ id: p.id, title: p.title, status: p.status }))}
    >
      <div className="task-board">
        <div className="task-upload-panel" id="upload">
          <Dragger
            accept=".pdf"
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(file) => {
              handleUpload(file);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">拖拽或点击上传 PDF 论文</p>
            <p className="ant-upload-hint">使用 MinerU VLM 精准解析，单文件最大 200MB</p>
          </Dragger>
        </div>

        <div className="task-table-card">
          <div className="task-table-head">
            <Text strong style={{ fontSize: 16 }}>
              任务列表
            </Text>
            <Text type="secondary">共 {papers.length} 个任务</Text>
          </div>

          {papers.length === 0 ? (
            <Empty description="暂无论文，请在上方上传一份 PDF" />
          ) : (
            <div className="task-table-scroll">
              <table className="task-table">
                <thead>
                  <tr>
                    <th>任务名称</th>
                    <th>状态</th>
                    <th>进度</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {papers.map((p) => {
                    const st = STATUS_MAP[p.status] || {
                      color: "default",
                      label: p.status,
                    };
                    const pct =
                      p.total_pages > 0 && p.parsed_pages > 0
                        ? Math.round((p.parsed_pages / p.total_pages) * 100)
                        : p.status === "parsed" || p.status === "done"
                          ? 100
                          : 0;
                    const elapsedSeconds =
                      elapsedMap[p.id] ?? p.parse_elapsed_seconds ?? 0;
                    const progressLabel =
                      p.status === "parsing" || p.status === "uploading"
                        ? p.parsed_pages > 0 && p.total_pages > 0
                          ? `${st.label} ${p.parsed_pages}/${p.total_pages} 页`
                          : `${st.label} ${pct}%`
                        : p.status === "noting"
                          ? "生成笔记中"
                          : p.status === "done"
                            ? "已完成"
                            : `${pct}%`;

                    return (
                      <tr
                        key={p.id}
                        className="task-table-row-clickable"
                        onClick={() => navigate(`/papers/${p.id}`)}
                      >
                        <td>
                          <div className="task-name-cell">
                            <div className="task-file-icon">PDF</div>
                            <div className="task-name-text">
                              <strong>{p.title}</strong>
                              <Text type="secondary">
                                {p.total_pages > 0 ? `${p.total_pages} 页` : "等待页数"}
                                {elapsedSeconds > 0
                                  ? ` · ${formatElapsed(elapsedSeconds)}`
                                  : ""}
                              </Text>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Tag color={st.color}>{st.label}</Tag>
                        </td>
                        <td>
                          <div className="task-progress-cell">
                            <Progress
                              percent={pct}
                              size="small"
                              showInfo={false}
                              status={
                                p.status === "failed"
                                  ? "exception"
                                  : p.status === "done" || p.status === "parsed"
                                    ? "success"
                                    : "active"
                              }
                            />
                            <span className="task-progress-label">{progressLabel}</span>
                          </div>
                        </td>
                        <td>
                          <Text type="secondary">{formatCreatedAt(p.created_at)}</Text>
                        </td>
                        <td>
                          <Popconfirm
                            title="确认删除"
                            description="删除后将永久移除该论文的 PDF、解析结果、解读笔记及生成图片，且无法恢复。是否继续？"
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => handleDelete(p.id)}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Popconfirm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
