import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Dropdown,
  Modal,
  Progress,
  Segmented,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  MoreOutlined,
  ReloadOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import {
  api,
  buildPaperPdfUrl,
  ModelOption,
  NoteVersionSummary,
  PaperDetail,
  saveBlob,
  subscribeNoteRefineStream,
  subscribePaperEvents,
} from "../api/client";
import AiEditIcon from "../components/AiEditIcon";
import ChatPanel, { type ChatPanelMode } from "../components/ChatPanel";
import MarkdownPreview from "../components/MarkdownPreview";
import ModelSwitcher, { isCustomModel, modelLabel } from "../components/ModelSwitcher";
import NoteDiffModal from "../components/NoteDiffModal";
import NoteEditorPanel from "../components/NoteEditorPanel";
import NoteRenderer from "../components/NoteRenderer";
import PaperViewToggles, { type PaperViewPane } from "../components/PaperViewToggles";
import PdfViewer from "../components/PdfViewer";
import NoteGenerationPanel from "../components/NoteGenerationPanel";
import WorkspaceShell from "../components/WorkspaceShell";
import { useStreamEvents } from "../hooks/useStreamEvents";
import { useStickToBottom } from "../hooks/useStickToBottom";
import ScrollToBottomButton from "../components/ScrollToBottomButton";
import type { StreamEvent } from "../types/events";
import { formatElapsed } from "../utils/formatElapsed";
import { printNoteArea } from "../utils/printNote";

const { Text } = Typography;

const statusLabels: Record<string, string> = {
  uploading: "上传中",
  parsing: "解析中",
  parsed: "解析完成",
  noting: "生成笔记中",
  done: "已完成",
  failed: "失败",
};

const statusColors: Record<string, string> = {
  parsed: "success",
  done: "success",
  failed: "error",
};

const mineruStateLabels: Record<string, string> = {
  "waiting-file": "等待上传",
  pending: "排队中",
  running: "解析中",
  converting: "格式转换中",
  uploading: "上传中",
};

const NOTE_MODEL_KEY = "yanxi:note-model";

export default function PaperPage() {
  const { id } = useParams<{ id: string }>();
  const paperId = Number(id);
  const navigate = useNavigate();
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [loadingMd, setLoadingMd] = useState(false);
  const [activePanes, setActivePanes] = useState<PaperViewPane[]>(["note"]);
  const [mdViewMode, setMdViewMode] = useState<"preview" | "source">("preview");
  const [progress, setProgress] = useState(0);
  const [parseElapsed, setParseElapsed] = useState(0);
  const [mineruState, setMineruState] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatMode, setChatMode] = useState<ChatPanelMode>("qa");
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineApplying, setRefineApplying] = useState(false);
  const [refineOldContent, setRefineOldContent] = useState("");
  const [refineNewContent, setRefineNewContent] = useState("");
  const [refineModel, setRefineModel] = useState("");
  const [diffKind, setDiffKind] = useState<"refine" | "note_edit">("refine");
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [noteVersions, setNoteVersions] = useState<NoteVersionSummary[]>([]);
  const [versionPreview, setVersionPreview] = useState<{
    version: number;
    content: string;
  } | null>(null);
  const [versionPreviewLoading, setVersionPreviewLoading] = useState(false);
  const [versionRestoring, setVersionRestoring] = useState(false);
  const [noteEditApplyCtx, setNoteEditApplyCtx] = useState<{
    conversationId: number;
    assistantMessageId?: number;
  } | null>(null);
  const refineAbortRef = useRef<(() => void) | null>(null);
  const refineContentRef = useRef("");
  const [noteModels, setNoteModels] = useState<ModelOption[]>([]);
  const [noteModel, setNoteModel] = useState("");
  const [generatingModelLabel, setGeneratingModelLabel] = useState("");
  const [sidebarPapers, setSidebarPapers] = useState<
    { id: number; title: string; status: string }[]
  >([]);
  const sseStartedRef = useRef(false);
  const notePrintRef = useRef<HTMLDivElement>(null);

  const stream = useStreamEvents(`yanxi:paper:${paperId}:timeline`);
  const {
    setContent: setNoteContent,
    reset: resetStream,
    switchPaper: switchPaperStream,
    handleEvent,
    content: noteContent,
    pipelinePhase,
    outlineStatus,
    finalStatus,
    sectionProgress,
    sectionTimelines,
    noteSections,
  } = stream;
  const activePaperIdRef = useRef(paperId);
  activePaperIdRef.current = paperId;
  const isStreaming =
    paper?.status === "parsing" ||
    paper?.status === "uploading" ||
    paper?.status === "noting" ||
    paper?.status === "parsed" ||
    regenerating;

  useEffect(() => {
    void api.listModels().then((res) => {
      setNoteModels(res.models);
      const saved = localStorage.getItem(NOTE_MODEL_KEY);
      const pick =
        (saved && res.models.some((m) => m.id === saved) && saved) ||
        res.default_model;
      setNoteModel(pick);
    }).catch(() => {
      /* 模型列表加载失败时仍允许使用内置默认项 */
    });
  }, []);

  const handleNoteModelChange = useCallback((next: string) => {
    setNoteModel(next);
    localStorage.setItem(NOTE_MODEL_KEY, next);
  }, []);

  const loadPaper = useCallback(async () => {
    const id = paperId;
    const p = await api.getPaper(id);
    if (activePaperIdRef.current !== id) return;
    setPaper(p);
    setParseElapsed(p.parse_elapsed_seconds);
    setProgress(0);
    setMineruState("");
    if (p.has_note || p.status === "done" || p.status === "noting") {
      setActivePanes(["note"]);
    } else if (p.has_markdown) {
      setActivePanes(["markdown"]);
    } else {
      setActivePanes(["pdf"]);
    }
    if (p.has_note && (p.status === "done" || p.status === "noting")) {
      try {
        const note = await api.fetchNote(id);
        if (activePaperIdRef.current === id) setNoteContent(note);
      } catch {
        if (activePaperIdRef.current === id) setNoteContent("");
      }
    } else if (activePaperIdRef.current === id) {
      setNoteContent("");
    }
  }, [paperId, setNoteContent]);

  useEffect(() => {
    setPaper(null);
    setMarkdown("");
    setActivePanes(["note"]);
    setMdViewMode("preview");
    setRegenerating(false);
    setNoteEditing(false);
    setNoteDraft("");
    setNoteSaving(false);
    setChatMode("qa");
    sseStartedRef.current = false;
    switchPaperStream();
    loadPaper().catch((e) =>
      message.error(e instanceof Error ? e.message : "加载失败")
    );
  }, [paperId, switchPaperStream, loadPaper]);

  useEffect(() => {
    api
      .listPapers()
      .then((list) =>
        setSidebarPapers(list.map((p) => ({ id: p.id, title: p.title, status: p.status })))
      )
      .catch(() => {});
  }, [paperId, paper?.status]);

  const handleStreamEvent = useCallback(
    (ev: StreamEvent) => {
      if (activePaperIdRef.current !== paperId) return;
      handleEvent(ev);

      if (ev.type === "status") {
        if (ev.mineru_state) {
          setMineruState(ev.mineru_state);
        }
        if (ev.parse_elapsed_seconds != null) {
          setParseElapsed((prev) =>
            Math.max(prev, ev.parse_elapsed_seconds as number)
          );
        }
        if (ev.parsed_pages != null || ev.total_pages != null) {
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  parsed_pages: ev.parsed_pages ?? prev.parsed_pages,
                  total_pages: ev.total_pages ?? prev.total_pages,
                  status: ev.status || prev.status,
                }
              : prev
          );
        } else if (ev.status) {
          setPaper((prev) => (prev ? { ...prev, status: ev.status! } : prev));
        }
        if (ev.parsed_pages != null && ev.total_pages) {
          setProgress(Math.round((ev.parsed_pages / ev.total_pages) * 100));
        }
        if (ev.status === "noting") {
          setNoteEditing(false);
          setNoteDraft("");
          setActivePanes((prev) =>
            prev.includes("note") ? prev : [...prev, "note"]
          );
        }
        if (ev.status === "done") {
          void loadPaper();
        }
        if (ev.status === "failed") {
          message.error(ev.error || "处理失败");
          void loadPaper();
          setRegenerating(false);
        }
      }
    },
    [handleEvent, loadPaper, paperId]
  );

  const shouldStream = useMemo(() => {
    if (regenerating) return true;
    const s = paper?.status;
    return s === "parsing" || s === "uploading" || s === "noting";
  }, [paper?.status, regenerating]);

  useEffect(() => {
    if (!shouldStream) {
      sseStartedRef.current = false;
      return;
    }
    if (sseStartedRef.current) return;
    sseStartedRef.current = true;

    const streamPaperId = paperId;
    const unsub = subscribePaperEvents(
      streamPaperId,
      (ev) => {
        if (activePaperIdRef.current !== streamPaperId) return;
        handleStreamEvent(ev);
      },
      () => {
        if (activePaperIdRef.current !== streamPaperId) return;
        sseStartedRef.current = false;
        void loadPaper();
        setRegenerating(false);
        setGeneratingModelLabel("");
      }
    );
    return () => {
      unsub();
      sseStartedRef.current = false;
    };
  }, [paperId, shouldStream, handleStreamEvent, loadPaper]);

  const isParsing = paper?.status === "parsing" || paper?.status === "uploading";

  useEffect(() => {
    if (!isParsing) return;
    const timer = setInterval(() => {
      setParseElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isParsing]);

  const handleDelete = () => {
    Modal.confirm({
      title: "确认删除",
      content:
        "删除后将永久移除该论文的 PDF、解析结果、解读笔记及生成图片，且无法恢复。是否继续？",
      okText: "删除",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        try {
          await api.deletePaper(paperId);
          localStorage.removeItem(`yanxi:paper:${paperId}:timeline`);
          message.success("论文已删除");
          navigate("/");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
          return Promise.reject(e);
        }
      },
    });
  };

  const handleGenerateNote = async () => {
    if (!noteModel) {
      message.warning("请先选择笔记生成模型");
      return;
    }
    try {
      resetStream();
      setNoteContent("");
      setNoteEditing(false);
      setNoteDraft("");
      setGeneratingModelLabel(modelLabel(noteModels, noteModel));
      await api.regenerateNote(paperId, noteModel);
      setRegenerating(true);
      setPaper((p) => (p ? { ...p, status: "noting", has_note: false } : p));
    } catch (e) {
      setRegenerating(false);
      setGeneratingModelLabel("");
      message.error(e instanceof Error ? e.message : "生成失败");
    }
  };

  const loadMarkdown = useCallback(async () => {
    if (markdown) return markdown;
    setLoadingMd(true);
    try {
      const md = await api.fetchMarkdown(paperId);
      setMarkdown(md);
      return md;
    } finally {
      setLoadingMd(false);
    }
  }, [markdown, paperId]);

  useEffect(() => {
    if (!paper?.has_markdown) return;
    if (!activePanes.includes("markdown")) return;
    if (markdown) return;
    void loadMarkdown();
  }, [activePanes, paper?.has_markdown, markdown, loadMarkdown]);

  const handlePrintNotePdf = () => {
    try {
      if (noteEditing) {
        message.warning("请先保存或退出编辑后再打印");
        return;
      }
      if (!noteContent.trim()) {
        message.warning("笔记内容为空，请刷新页面后重试");
        return;
      }
      printNoteArea(notePrintRef.current);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "打印失败");
    }
  };

  const handleDownloadNote = async (format: "zip" | "pdf") => {
    if (format === "pdf") {
      handlePrintNotePdf();
      return;
    }
    try {
      const result = await api.downloadNoteZip(paperId);
      saveBlob(result.blob, result.filename);
      message.success("Markdown 压缩包已开始下载");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "下载失败");
    }
  };

  const noteStreaming = isStreaming && (paper?.status === "noting" || regenerating);

  const noteStickEnabled =
    pipelinePhase === "final" && finalStatus === "running";

  const {
    bindContainer: bindNoteScrollContainer,
    handleScroll: handleNoteScroll,
    jumpToBottom: jumpNoteToBottom,
    showScrollToBottom: showNoteScrollToBottom,
  } = useStickToBottom({
    enabled: noteStickEnabled,
    contentDeps: [noteContent],
  });

  const loadVersionPreview = useCallback(
    async (version: number) => {
      setVersionPreviewLoading(true);
      try {
        const content = await api.getNoteVersion(paperId, version);
        setVersionPreview({ version, content });
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载版本失败");
      } finally {
        setVersionPreviewLoading(false);
      }
    },
    [paperId]
  );

  const openVersionHistory = useCallback(async () => {
    try {
      const data = await api.listNoteVersions(paperId);
      setNoteVersions(data.items);
      setVersionModalOpen(true);
      const pick =
        data.items.find((v) => !v.is_current)?.version ??
        data.items[data.items.length - 1]?.version ??
        data.current_version;
      if (pick) await loadVersionPreview(pick);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载版本列表失败");
    }
  }, [paperId, loadVersionPreview]);

  if (!paper) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  const pdfUrl = buildPaperPdfUrl(paperId);
  const isNoting = paper.status === "noting" || regenerating;
  const canEditNote =
    Boolean(noteContent.trim()) &&
    !noteStreaming &&
    !isNoting &&
    (paper.has_note || paper.status === "done");
  const noteDirty = noteEditing && noteDraft !== noteContent;

  const handleStartEdit = () => {
    if (!canEditNote) return;
    if (chatMode === "note_edit") {
      message.warning("请先完成或退出 AI 编辑");
      return;
    }
    setNoteDraft(noteContent);
    setNoteEditing(true);
  };

  const handleStartAiEdit = () => {
    if (!canEditNote) return;
    if (noteEditing) {
      message.warning("请先保存或退出手动编辑");
      return;
    }
    setChatCollapsed(false);
    setChatMode("note_edit");
  };

  const handleExitAiEdit = () => {
    setChatMode("qa");
  };

  const handleNoteEditRequestReview = (
    draft: string,
    ctx: { conversationId: number; assistantMessageId?: number }
  ) => {
    if (!noteContent.trim()) {
      message.warning("笔记内容为空");
      return;
    }
    if (!draft.trim()) {
      message.warning("修改稿为空");
      return;
    }
    refineAbortRef.current?.();
    setNoteEditApplyCtx(ctx);
    setDiffKind("note_edit");
    setRefineOldContent(noteContent);
    setRefineNewContent(draft);
    setRefineModel("");
    setRefineLoading(false);
    setRefineOpen(true);
  };

  const handleCancelEdit = () => {
    if (noteDirty) {
      Modal.confirm({
        title: "放弃未保存的修改？",
        content: "当前编辑内容尚未保存，确定要退出吗？",
        okText: "放弃修改",
        cancelText: "继续编辑",
        okType: "danger",
        onOk: () => {
          setNoteEditing(false);
          setNoteDraft("");
        },
      });
      return;
    }
    setNoteEditing(false);
    setNoteDraft("");
  };

  const startNoteRefine = (
    conversationId: number,
    scope: "turn" | "conversation",
    assistantMessageId: number | undefined,
    chatModel: string
  ) => {
    if (!noteContent.trim()) {
      message.warning("笔记内容为空，无法融合");
      return;
    }
    if (!chatModel) {
      message.warning("请先在 AI 助手中选择模型");
      return;
    }
    refineAbortRef.current?.();
    refineContentRef.current = "";
    setDiffKind("refine");
    setRefineOldContent(noteContent);
    setRefineNewContent("");
    setRefineModel(chatModel);
    setRefineOpen(true);
    setRefineLoading(true);

    refineAbortRef.current = subscribeNoteRefineStream(
      paperId,
      {
        conversation_id: conversationId,
        scope,
        intent: "refine",
        assistant_message_id: assistantMessageId,
        model: chatModel,
      },
      (ev) => {
        if (ev.type === "content" && ev.delta) {
          refineContentRef.current += ev.delta;
          setRefineNewContent(refineContentRef.current);
        }
        if (ev.type === "status" && ev.status === "failed") {
          message.error(ev.error || "笔记融合失败");
        }
      },
      () => {
        setRefineLoading(false);
        setRefineNewContent(refineContentRef.current);
      }
    );
  };

  const handleApplyRefinedNote = async (content: string) => {
    if (!content.trim()) {
      message.warning("融合结果为空");
      return;
    }
    setRefineApplying(true);
    try {
      const result = await api.applyRefinedNote(
        paperId,
        content,
        diffKind === "note_edit" && noteEditApplyCtx
          ? {
              conversation_id: noteEditApplyCtx.conversationId,
              assistant_message_id: noteEditApplyCtx.assistantMessageId,
            }
          : undefined
      );
      const saved = await api.fetchNote(paperId);
      setNoteContent(saved);
      setPaper((p) =>
        p ? { ...p, has_note: true, note_version: result.note_version } : p
      );
      setRefineOpen(false);
      setNoteEditApplyCtx(null);
      message.success(`笔记已更新至 v${result.note_version}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRefineApplying(false);
    }
  };

  const handleCancelRefine = () => {
    refineAbortRef.current?.();
    setRefineOpen(false);
    setRefineLoading(false);
    setRefineNewContent("");
  };

  const handleRepairGenFigures = async () => {
    setVersionRestoring(true);
    try {
      const result = await api.repairNoteGenFigures(paperId);
      if (!result.repaired) {
        message.info(result.message || "无遗漏配图");
        return;
      }
      const content = await api.fetchNote(paperId);
      setNoteContent(content);
      setPaper((p) =>
        p
          ? {
              ...p,
              has_note: true,
              note_version: result.note_version ?? p.note_version,
            }
          : p
      );
      const list = await api.listNoteVersions(paperId);
      setNoteVersions(list.items);
      await loadVersionPreview(list.current_version);
      message.success(
        `已补全 ${result.figures?.length ?? 0} 张配图，当前 v${result.note_version}`
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "补全失败");
    } finally {
      setVersionRestoring(false);
    }
  };

  const handleRestoreVersion = (version: number) => {
    Modal.confirm({
      title: `恢复为 v${version}？`,
      content: "将把当前笔记备份后，用所选版本内容覆盖。",
      okText: "恢复",
      cancelText: "取消",
      onOk: async () => {
        setVersionRestoring(true);
        try {
          const result = await api.restoreNoteVersion(paperId, version);
          const content = await api.fetchNote(paperId);
          setNoteContent(content);
          setPaper((p) =>
            p ? { ...p, has_note: true, note_version: result.note_version } : p
          );
          setVersionModalOpen(false);
          message.success(`已恢复并保存为 v${result.note_version}`);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "恢复失败");
          throw e;
        } finally {
          setVersionRestoring(false);
        }
      },
    });
  };

  const handleSaveNote = async () => {
    if (!noteDraft.trim()) {
      message.warning("笔记内容不能为空");
      return;
    }
    setNoteSaving(true);
    try {
      const result = await api.updateNote(paperId, noteDraft);
      setNoteContent(noteDraft);
      setPaper((p) =>
        p ? { ...p, has_note: true, note_version: result.note_version } : p
      );
      setNoteEditing(false);
      setNoteDraft("");
      message.success("笔记已保存");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  const totalLabel = paper.total_pages ? paper.total_pages : "?";
  const hasPageProgress = paper.total_pages > 0 && paper.parsed_pages > 0;
  const showParseProgress = isParsing || paper.status === "parsed";
  const parsingProgress = hasPageProgress
    ? Math.round((paper.parsed_pages / paper.total_pages) * 100)
    : progress;
  const parseProgressPercent =
    paper.status === "parsed"
      ? 100
      : hasPageProgress
        ? parsingProgress
        : 0;
  const mineruStateLabel =
    mineruStateLabels[mineruState] || (isParsing ? "解析中" : "解析完成");
  const elapsedLabel =
    parseElapsed > 0 ? formatElapsed(parseElapsed) : null;
  const parseProgressText =
    paper.status === "parsed"
      ? `MinerU 解析完成 ${paper.parsed_pages || paper.total_pages}/${totalLabel} 页${
          elapsedLabel ? ` · 用时 ${elapsedLabel}` : ""
        }`
      : hasPageProgress
        ? `MinerU ${mineruStateLabel} ${paper.parsed_pages}/${totalLabel} 页${
            elapsedLabel ? ` · 已用时 ${elapsedLabel}` : ""
          }`
        : paper.total_pages
          ? `MinerU ${mineruStateLabel} · PDF 共 ${totalLabel} 页${
              elapsedLabel ? ` · 已用时 ${elapsedLabel}` : ""
            }`
          : `MinerU ${mineruStateLabel}${
              elapsedLabel ? ` · 已用时 ${elapsedLabel}` : ""
            }`;

  const showPdf = activePanes.includes("pdf");
  const showMd = activePanes.includes("markdown");
  const showNote = activePanes.includes("note");
  const paneCount = activePanes.length;
  const noteAvailable =
    Boolean(noteContent.trim()) ||
    isNoting ||
    paper.has_note ||
    paper.status === "done" ||
    paper.status === "parsed";

  const customNoteModel = isCustomModel(noteModels, noteModel);

  const activeNoteModelLabel = isNoting
    ? generatingModelLabel || modelLabel(noteModels, noteModel)
    : paper.note_model_label;

  const renderNotePanel = () => (
    <div className={`note-panel${noteEditing ? " note-panel--editing" : ""}`}>
      <NoteGenerationPanel
        active={isNoting}
        pipelinePhase={pipelinePhase}
        outlineStatus={outlineStatus}
        finalStatus={finalStatus}
        sections={noteSections}
        sectionProgress={sectionProgress}
        sectionTimelines={sectionTimelines}
        paperId={paperId}
        modelLabel={activeNoteModelLabel}
      />
      <div className={`note-print-area${noteEditing ? " note-print-area--hidden" : ""}`} ref={notePrintRef}>
        {activeNoteModelLabel && (noteContent || isNoting) ? (
          <p className="note-model-caption">
            {isNoting ? "正在使用" : "本笔记由"} {activeNoteModelLabel} 生成
          </p>
        ) : null}
        <h1 className="note-print-title">{paper.title}</h1>
        {noteContent || isNoting ? (
          <>
            {isNoting && !noteContent.trim() && pipelinePhase !== "final" && (
              <div className="note-draft-waiting">
                <Spin size="small" />
                <span>
                  {pipelinePhase === "outline"
                    ? "正在解析论文大纲，完成后将并行撰写各章节草稿…"
                    : "各章节草稿并行生成中，完成后将综合输出最终笔记…"}
                </span>
              </div>
            )}
            <NoteRenderer
              content={noteContent}
              paperId={paperId}
              streaming={noteStreaming}
            />
          </>
        ) : (
          <div className="note-empty-state">
            {paper.status === "parsed" && !isParsing ? (
              <>
                <p>解析已完成，可开始生成解读笔记。</p>
                <div className="note-generate-actions">
                  {noteModels.length > 0 ? (
                    <ModelSwitcher
                      models={noteModels}
                      value={noteModel}
                      onChange={handleNoteModelChange}
                      compact
                    />
                  ) : null}
                  <Button type="primary" onClick={() => void handleGenerateNote()}>
                    生成解读笔记
                  </Button>
                </div>
                {customNoteModel ? (
                  <p className="note-generate-hint">自定义模型不支持联网搜索</p>
                ) : null}
              </>
            ) : (
              <p>{isParsing ? "解析完成后可生成解读笔记。" : "暂无笔记"}</p>
            )}
          </div>
        )}
      </div>
      {noteEditing && (
        <NoteEditorPanel
          draft={noteDraft}
          paperId={paperId}
          onDraftChange={setNoteDraft}
        />
      )}
    </div>
  );

  const moreMenuItems: MenuProps["items"] = [
    ...(paper.status === "parsed" && !paper.has_note && !isNoting
      ? [
          {
            key: "generate",
            label: "生成解读笔记",
            onClick: () => void handleGenerateNote(),
          },
        ]
      : []),
    ...((paper.has_note || paper.status === "done")
      ? [
          {
            key: "regenerate",
            icon: <ReloadOutlined />,
            label: "重新生成笔记",
            disabled: isNoting,
            onClick: () => void handleGenerateNote(),
          },
        ]
      : []),
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除任务",
      danger: true,
      onClick: handleDelete,
    },
  ];

  const noteToolbar = noteEditing ? (
    <div className="note-toolbar note-toolbar--editing">
      {noteDirty && (
        <span className="note-edit-status">未保存</span>
      )}
      <Button
        type="primary"
        size="small"
        icon={<CheckOutlined />}
        loading={noteSaving}
        onClick={() => void handleSaveNote()}
      >
        保存
      </Button>
      <Button
        size="small"
        icon={<CloseOutlined />}
        disabled={noteSaving}
        onClick={handleCancelEdit}
      >
        取消
      </Button>
    </div>
  ) : (
    <div className="note-toolbar">
      {showNote && noteModels.length > 0 && !isNoting && (
        <ModelSwitcher
          models={noteModels}
          value={noteModel}
          onChange={handleNoteModelChange}
          compact
          disabled={noteStreaming}
        />
      )}
      {(paper.has_note || paper.status === "done") && showNote && paper.note_version > 0 && (
        <Tooltip title="笔记版本历史">
          <button
            type="button"
            className="note-version-btn"
            onClick={() => void openVersionHistory()}
            aria-label="笔记版本"
          >
            <HistoryOutlined style={{ marginRight: 4 }} />
            v{paper.note_version}
          </button>
        </Tooltip>
      )}
      {canEditNote && showNote && (
        <>
          <Tooltip title="AI 编辑笔记">
            <button
              type="button"
              className={`note-toolbar-btn note-toolbar-btn--ai-edit${
                chatMode === "note_edit" ? " is-active" : ""
              }`}
              onClick={handleStartAiEdit}
              aria-label="AI 编辑笔记"
            >
              <AiEditIcon />
            </button>
          </Tooltip>
          <Tooltip title="手动编辑">
            <button
              type="button"
              className="note-toolbar-btn"
              onClick={handleStartEdit}
              aria-label="手动编辑笔记"
            >
              <EditOutlined />
            </button>
          </Tooltip>
        </>
      )}
      {(paper.has_note || paper.status === "done") && showNote && (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "pdf",
                label: "导出 PDF",
                onClick: handlePrintNotePdf,
              },
              {
                key: "zip",
                label: "导出 Markdown 压缩包",
                onClick: () => void handleDownloadNote("zip"),
              },
            ],
          }}
        >
          <Tooltip title="下载笔记">
            <button type="button" className="note-toolbar-btn" aria-label="下载笔记">
              <DownloadOutlined />
            </button>
          </Tooltip>
        </Dropdown>
      )}
      <Dropdown trigger={["click"]} menu={{ items: moreMenuItems }}>
        <Tooltip title="更多">
          <button type="button" className="note-toolbar-btn" aria-label="更多">
            <MoreOutlined />
          </button>
        </Tooltip>
      </Dropdown>
    </div>
  );

  const paperActions = (
    <Tag color={statusColors[paper.status] ?? "processing"} className="paper-status-tag">
      {statusLabels[paper.status] ?? paper.status}
    </Tag>
  );

  return (
    <WorkspaceShell
      title={paper.title}
      papers={sidebarPapers}
      currentPaperId={paperId}
      headerActions={paperActions}
    >

      <div className="paper-page-outer">
        {showParseProgress && (
          <div className="parse-progress-card">
            <Text type="secondary">{parseProgressText}</Text>
            <Progress
              percent={parseProgressPercent}
              status={paper.status === "parsed" ? "success" : "active"}
              showInfo={hasPageProgress || paper.status === "parsed"}
              style={{ marginTop: 8 }}
            />
          </div>
        )}

        <div
          className={`paper-page-root${
            paper.has_note || paper.status === "done"
              ? chatCollapsed
                ? " paper-page-root--chat-collapsed"
                : " paper-page-root--chat-open"
              : ""
          }`}
        >
          <div className="paper-workspace">
            <div className="compare-panel paper-workspace-panel" key={paperId}>
              <div className="compare-panel-header note-panel-header">
                <div className="note-panel-header-left">
                  <PaperViewToggles
                    active={activePanes}
                    onChange={setActivePanes}
                    hasMarkdown={paper.has_markdown}
                    noteAvailable={noteAvailable}
                  />
                </div>
                {noteToolbar}
              </div>
              <div
                className={`paper-compare-body paper-compare-body--${paneCount}`}
              >
                {showPdf && (
                  <div className="paper-compare-pane">
                    <div className="paper-compare-pane-label">原文 PDF</div>
                    <div className="paper-compare-pane-content">
                      <PdfViewer url={pdfUrl} />
                    </div>
                  </div>
                )}
                {showMd && (
                  <div className="paper-compare-pane">
                    <div className="paper-compare-pane-header">
                      <span className="paper-compare-pane-label">解析 Markdown</span>
                      {markdown && !loadingMd && (
                        <Segmented
                          size="small"
                          className="paper-md-mode-switch"
                          value={mdViewMode}
                          onChange={(v) => setMdViewMode(v as "preview" | "source")}
                          options={[
                            { label: "预览", value: "preview" },
                            { label: "源码", value: "source" },
                          ]}
                        />
                      )}
                    </div>
                    <div className="paper-compare-pane-content">
                      {loadingMd ? (
                        <div className="paper-compare-pane-loading">
                          <Spin />
                        </div>
                      ) : markdown ? (
                        mdViewMode === "source" ? (
                          <pre className="markdown-source paper-md-source">
                            {markdown}
                          </pre>
                        ) : (
                          <MarkdownPreview content={markdown} paperId={paperId} />
                        )
                      ) : (
                        <div className="paper-compare-pane-empty">
                          暂无解析 Markdown
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {showNote && (
                  <div className="paper-compare-pane paper-compare-pane--note">
                    <div className="paper-compare-pane-label">解读笔记</div>
                    <div className="paper-compare-pane-scroll-wrap">
                      <div
                        className="paper-compare-pane-content"
                        ref={bindNoteScrollContainer}
                        onScroll={handleNoteScroll}
                      >
                        {renderNotePanel()}
                      </div>
                      <ScrollToBottomButton
                        visible={showNoteScrollToBottom}
                        onClick={jumpNoteToBottom}
                        className="stick-scroll-bottom-btn note-scroll-bottom-btn"
                        title="跟随最新内容"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(paper.has_note || paper.status === "done") && (
            <ChatPanel
              paperId={paperId}
              collapsed={chatCollapsed}
              onToggleCollapsed={() => setChatCollapsed((v) => !v)}
              enabled
              mode={chatMode}
              onExitNoteEdit={handleExitAiEdit}
              onNoteEditRequestReview={handleNoteEditRequestReview}
              refining={refineLoading || refineApplying}
              onRefineTurn={(messageId, conversationId, chatModel) =>
                startNoteRefine(conversationId, "turn", messageId, chatModel)
              }
              onRefineConversation={(conversationId, chatModel) =>
                startNoteRefine(conversationId, "conversation", undefined, chatModel)
              }
            />
          )}
        </div>
      </div>

      <NoteDiffModal
        open={refineOpen}
        loading={refineLoading}
        oldContent={refineOldContent}
        newContent={refineNewContent}
        paperId={paperId}
        refineModel={refineModel || undefined}
        applying={refineApplying}
        title={diffKind === "note_edit" ? "AI 编辑预览" : undefined}
        applyLabel={diffKind === "note_edit" ? "应用修改" : undefined}
        loadingHint={
          diffKind === "note_edit"
            ? "正在加载修改稿…"
            : undefined
        }
        onApply={(merged) => void handleApplyRefinedNote(merged)}
        onCancel={handleCancelRefine}
      />

      <Modal
        title="笔记版本"
        open={versionModalOpen}
        onCancel={() => setVersionModalOpen(false)}
        width={920}
        footer={null}
        destroyOnHidden
        className="note-version-modal"
      >
        <div className="note-version-layout">
          <div className="note-version-list">
            {noteVersions.length === 0 ? (
              <Text type="secondary">暂无版本记录</Text>
            ) : (
              noteVersions.map((v) => (
                <button
                  key={v.version}
                  type="button"
                  className={`note-version-item${
                    versionPreview?.version === v.version
                      ? " note-version-item--active"
                      : ""
                  }`}
                  onClick={() => void loadVersionPreview(v.version)}
                >
                  <span className="note-version-item-title">
                    v{v.version}
                    {v.is_current ? " · 当前" : ""}
                  </span>
                  {v.model ? (
                    <span className="note-version-item-meta">{v.model}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <div className="note-version-preview-pane">
            {versionPreviewLoading ? (
              <div className="note-version-preview-loading">
                <Spin />
              </div>
            ) : versionPreview ? (
              <>
                <div className="note-version-preview-toolbar">
                  <Text type="secondary">
                    预览 v{versionPreview.version}
                    {noteVersions.find((v) => v.version === versionPreview.version)
                      ?.is_current
                      ? "（当前笔记）"
                      : ""}
                  </Text>
                  <div className="note-version-preview-actions">
                    {!noteVersions.find(
                      (v) => v.version === versionPreview.version && v.is_current
                    ) ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={versionRestoring}
                        onClick={() => handleRestoreVersion(versionPreview.version)}
                      >
                        恢复此版本
                      </Button>
                    ) : null}
                    {noteVersions.some(
                      (v) => v.is_current && v.version === versionPreview.version
                    ) ? (
                      <Button
                        size="small"
                        loading={versionRestoring}
                        onClick={() => void handleRepairGenFigures()}
                      >
                        补全遗漏配图
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="note-version-preview-body">
                  <MarkdownPreview
                    content={versionPreview.content}
                    paperId={paperId}
                  />
                </div>
              </>
            ) : (
              <Text type="secondary">选择左侧版本进行预览</Text>
            )}
          </div>
        </div>
      </Modal>

    </WorkspaceShell>
  );
}
