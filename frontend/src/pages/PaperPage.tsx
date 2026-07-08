import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Dropdown,
  Modal,
  Progress,
  Segmented,
  Select,
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
} from "@ant-design/icons";
import {
  api,
  buildPaperPdfUrl,
  ImageModelOption,
  ModelOption,
  PaperDetail,
  saveBlob,
  subscribeNoteRefineStream,
  subscribePaperEvents,
} from "../api/client";
import ChatPanel from "../components/ChatPanel";
import MarkdownPreview from "../components/MarkdownPreview";
import NoteRenderer from "../components/NoteRenderer";
import ModelSwitcher, { modelLabel } from "../components/ModelSwitcher";
import ImageModelPicker, {
  IMAGE_MODEL_KEY,
  pickDefaultImageModel,
  resolveImageModelOptions,
} from "../components/ImageModelPicker";
import NoteDiffModal from "../components/NoteDiffModal";
import SectionFigureModal from "../components/SectionFigureModal";
import SectionRefineModal from "../components/SectionRefineModal";
import NoteEditorPanel from "../components/NoteEditorPanel";
import PaperViewToggles, { type PaperViewPane } from "../components/PaperViewToggles";
import PdfViewer from "../components/PdfViewer";
import NoteGenerationPanel from "../components/NoteGenerationPanel";
import WorkspaceShell from "../components/WorkspaceShell";
import { useStreamEvents } from "../hooks/useStreamEvents";
import { useStickToBottom } from "../hooks/useStickToBottom";
import { useNoteReadProgress } from "../hooks/useNoteReadProgress";
import { useStreamDisplayContent } from "../hooks/useStreamDisplayContent";
import ScrollToBottomButton from "../components/ScrollToBottomButton";
import type { StreamEvent } from "../types/events";
import { invalidatePaperFigureBlob } from "../utils/imageBlobCache";
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
const MD_TRANSLATE_MODEL = "deepseek-v4-flash";
const MD_TRANSLATE_MODEL_LABEL = "DeepSeek V4 Flash";

type MdViewMode = "preview" | "translation";

export default function PaperPage() {
  const { id } = useParams<{ id: string }>();
  const paperId = Number(id);
  const navigate = useNavigate();
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [loadingMd, setLoadingMd] = useState(false);
  const [activePanes, setActivePanes] = useState<PaperViewPane[]>(["note"]);
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>("preview");
  const [mdTranslation, setMdTranslation] = useState("");
  const [loadingMdTranslation, setLoadingMdTranslation] = useState(false);
  const [translatingMd, setTranslatingMd] = useState(false);
  const [mdTranslateModel, setMdTranslateModel] = useState(MD_TRANSLATE_MODEL);
  const [mdTranslateProgress, setMdTranslateProgress] = useState<{
    chunk: number;
    total: number;
  } | null>(null);
  const mdTranslateUnsubRef = useRef<(() => void) | null>(null);
  const mdTranslateGotContentRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [parseElapsed, setParseElapsed] = useState(0);
  const [mineruState, setMineruState] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);

  useEffect(() => {
    setChatFullscreen(false);
  }, [paperId]);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineApplying, setRefineApplying] = useState(false);
  const [refineOldContent, setRefineOldContent] = useState("");
  const [refineNewContent, setRefineNewContent] = useState("");
  const [refineModel, setRefineModel] = useState("");
  const [sectionFigureLoading, setSectionFigureLoading] = useState<string | null>(
    null
  );
  const [figureModalHeading, setFigureModalHeading] = useState<string | null>(null);
  const [refineModalHeading, setRefineModalHeading] = useState<string | null>(null);
  const [refineDiffSource, setRefineDiffSource] = useState<"chat" | "section">("chat");
  const [deletingFigurePath, setDeletingFigurePath] = useState<string | null>(null);
  const refineAbortRef = useRef<(() => void) | null>(null);
  const refineContentRef = useRef("");
  const [noteModels, setNoteModels] = useState<ModelOption[]>([]);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [mcpSearchAvailable, setMcpSearchAvailable] = useState(false);
  const [noteModel, setNoteModel] = useState("");
  const [imageModel, setImageModel] = useState("sensenova");
  const [generatingModelLabel, setGeneratingModelLabel] = useState("");
  const sseStartedRef = useRef(false);
  const notePrintRef = useRef<HTMLDivElement>(null);
  const noteContentRef = useRef("");

  const stream = useStreamEvents(`yanxi:paper:${paperId}:timeline`);
  const {
    setContent: setNoteContent,
    reset: resetStream,
    switchPaper: switchPaperStream,
    applyPipelineState,
    hydrateCompletedNote,
    handleEvent,
    content: noteContent,
    pipelinePhase,
    outlineStatus,
    finalStatus,
    sectionProgress,
    sectionTimelines,
    noteSections,
  } = stream;

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  const activePaperIdRef = useRef(paperId);
  activePaperIdRef.current = paperId;
  const isStreaming =
    paper?.status === "parsing" ||
    paper?.status === "uploading" ||
    paper?.status === "noting" ||
    paper?.status === "parsed" ||
    regenerating;

  const effectiveImageModels = resolveImageModelOptions(imageModels);

  useEffect(() => {
    void api.listModels().then((res) => {
      setNoteModels(res.models);
      const resolved = resolveImageModelOptions(res.image_models);
      setImageModels(resolved);
      setMcpSearchAvailable(Boolean(res.mcp_search_available));
      const saved = localStorage.getItem(NOTE_MODEL_KEY);
      const pick =
        (saved && res.models.some((m) => m.id === saved) && saved) ||
        res.default_model;
      setNoteModel(pick);
      const savedImage = localStorage.getItem(IMAGE_MODEL_KEY);
      setImageModel(pickDefaultImageModel(resolved, savedImage));
    }).catch(() => {
      /* 模型列表加载失败时仍允许使用内置默认项 */
    });
  }, []);

  const handleNoteModelChange = useCallback((next: string) => {
    setNoteModel(next);
    localStorage.setItem(NOTE_MODEL_KEY, next);
  }, []);

  const handleImageModelChange = useCallback((next: string) => {
    setImageModel(next);
    localStorage.setItem(IMAGE_MODEL_KEY, next);
  }, []);

  const loadPaper = useCallback(
    async (opts?: { refreshNote?: boolean }) => {
      const refreshNote = opts?.refreshNote !== false;
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
      if (!refreshNote) return;
      if (p.has_note && (p.status === "done" || p.status === "noting")) {
        try {
          const notePromise = api.fetchNote(id);
          const tracePromise =
            p.status === "done" ? api.fetchNoteGenerationTrace(id) : Promise.resolve(null);
          const [note, trace] = await Promise.all([notePromise, tracePromise]);
          if (activePaperIdRef.current !== id) return;
          setNoteContent((current) => (current === note ? current : note));
          if (trace) {
            applyPipelineState(trace);
          }
        } catch {
          if (activePaperIdRef.current === id) setNoteContent("");
        }
      } else if (activePaperIdRef.current === id) {
        setNoteContent("");
      }
    },
    [applyPipelineState, paperId, setNoteContent]
  );

  useEffect(() => {
    setPaper(null);
    setMarkdown("");
    setMdTranslation("");
    setActivePanes(["note"]);
    setMdViewMode("preview");
    setTranslatingMd(false);
    setLoadingMdTranslation(false);
    setMdTranslateProgress(null);
    mdTranslateUnsubRef.current?.();
    mdTranslateUnsubRef.current = null;
    setRegenerating(false);
    setNoteEditing(false);
    setNoteDraft("");
    setNoteSaving(false);
    sseStartedRef.current = false;
    switchPaperStream();
    loadPaper().catch((e) =>
      message.error(e instanceof Error ? e.message : "加载失败")
    );
  }, [paperId, switchPaperStream, loadPaper]);

  useEffect(() => {
    if (!paper?.has_note) return;
    if (paper.status === "noting" || regenerating) return;
    const hasDetailedTrace = Object.values(sectionTimelines).some(
      (items) => items.length > 0
    );
    if (hasDetailedTrace) return;
    hydrateCompletedNote();
  }, [
    paper?.has_note,
    paper?.status,
    regenerating,
    sectionTimelines,
    hydrateCompletedNote,
  ]);

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
          const hasStreamedNote = noteContentRef.current.trim().length > 0;
          void loadPaper({ refreshNote: !hasStreamedNote });
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
        const hasStreamedNote = noteContentRef.current.trim().length > 0;
        void loadPaper({ refreshNote: !hasStreamedNote });
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
      await api.regenerateNote(paperId, noteModel, imageModel);
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

  const loadMdTranslation = useCallback(async () => {
    if (mdTranslation) return mdTranslation;
    setLoadingMdTranslation(true);
    try {
      const text = await api.fetchMarkdownTranslation(paperId);
      if (text) setMdTranslation(text);
      return text ?? "";
    } finally {
      setLoadingMdTranslation(false);
    }
  }, [mdTranslation, paperId]);

  useEffect(() => {
    if (!paper?.has_markdown_translation) return;
    if (!activePanes.includes("markdown")) return;
    if (mdTranslation) return;
    void loadMdTranslation();
  }, [
    activePanes,
    paper?.has_markdown_translation,
    mdTranslation,
    loadMdTranslation,
  ]);

  useEffect(() => {
    if (mdViewMode !== "translation") return;
    if (mdTranslation || loadingMdTranslation || translatingMd) return;
    if (paper?.has_markdown_translation) {
      void loadMdTranslation();
    }
  }, [
    mdViewMode,
    mdTranslation,
    loadingMdTranslation,
    translatingMd,
    paper?.has_markdown_translation,
    loadMdTranslation,
  ]);

  const handleTranslateMarkdown = async () => {
    let source = markdown;
    if (!source) {
      source = (await loadMarkdown()) ?? "";
    }
    if (!source.trim()) {
      message.warning("Markdown 内容为空");
      return;
    }
    mdTranslateUnsubRef.current?.();
    mdTranslateGotContentRef.current = false;
    setMdTranslation("");
    setMdTranslateProgress(null);
    setMdViewMode("translation");
    setTranslatingMd(true);

    mdTranslateUnsubRef.current = api.subscribeMarkdownTranslateStream(
      paperId,
      mdTranslateModel,
      (ev) => {
        if (ev.type === "content" && ev.delta) {
          mdTranslateGotContentRef.current = true;
          setMdTranslation((prev) => prev + ev.delta);
        }
        if (ev.type === "status" && ev.phase === "translating") {
          const chunk = (ev as StreamEvent & { chunk?: number }).chunk;
          const total = (ev as StreamEvent & { total?: number }).total;
          if (chunk != null && total != null) {
            setMdTranslateProgress({ chunk, total });
          }
        }
        if (ev.type === "status" && ev.status === "failed") {
          message.error(ev.error || "翻译失败");
          setTranslatingMd(false);
          setMdTranslateProgress(null);
        }
      },
      () => {
        setTranslatingMd(false);
        setMdTranslateProgress(null);
        mdTranslateUnsubRef.current = null;
        if (mdTranslateGotContentRef.current) {
          setPaper((prev) =>
            prev ? { ...prev, has_markdown_translation: true } : prev
          );
          message.success("中文翻译已生成");
        }
      }
    );
  };

  const mdTranslationDisplay = useStreamDisplayContent(mdTranslation, translatingMd, 50);

  useEffect(() => {
    return () => {
      mdTranslateUnsubRef.current?.();
      mdTranslateUnsubRef.current = null;
    };
  }, []);

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

  const noteDisplayContent = useStreamDisplayContent(noteContent, noteStreaming, 50);

  /** 非流式：仅按配图路径签名刷新图片缓存（禁止用内容长度，否则 v0.0.6 会每 chunk remount） */
  const noteFigureSignature = useMemo(() => {
    if (noteStreaming) return undefined;
    const imgs = [
      ...noteDisplayContent.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g),
    ].map((m) => m[1]);
    return imgs.length > 0 ? imgs.join("|") : undefined;
  }, [noteDisplayContent, noteStreaming]);

  const noteStickEnabled =
    pipelinePhase === "final" && finalStatus === "running";

  const noteReadEnabled =
    Boolean(paper?.has_note && noteContent.trim()) &&
    !noteStreaming &&
    !(paper?.status === "noting" || regenerating) &&
    !noteEditing;

  const {
    bindContainer: bindNoteScrollContainer,
    handleScroll: handleNoteScroll,
    jumpToBottom: jumpNoteToBottom,
    showScrollToBottom: showNoteScrollToBottom,
  } = useStickToBottom({
    enabled: noteStickEnabled,
    contentDeps: [noteDisplayContent],
  });

  const { handleScroll: handleNoteReadScroll, restoreScroll: restoreNoteScroll } =
    useNoteReadProgress({
      paperId,
      noteReadEpoch: paper?.note_read_epoch ?? 0,
      initialScrollTop: paper?.note_last_scroll_top ?? 0,
      enabled: noteReadEnabled,
    });

  const noteScrollContainerRef = useRef<HTMLDivElement | null>(null);

  const bindNotePaneContainer = useCallback(
    (el: HTMLDivElement | null) => {
      noteScrollContainerRef.current = el;
      bindNoteScrollContainer(el);
      if (el && noteReadEnabled) {
        restoreNoteScroll(el);
      }
    },
    [bindNoteScrollContainer, noteReadEnabled, restoreNoteScroll]
  );

  const handleNotePaneScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      handleNoteScroll(e);
      handleNoteReadScroll(e);
    },
    [handleNoteScroll, handleNoteReadScroll]
  );

  useEffect(() => {
    if (noteReadEnabled && noteScrollContainerRef.current) {
      restoreNoteScroll(noteScrollContainerRef.current);
    }
  }, [noteReadEnabled, noteDisplayContent, restoreNoteScroll]);

  const handleAddSectionFigure = useCallback(
    async (heading: string, instruction = "") => {
      if (sectionFigureLoading) return;
      setSectionFigureLoading(heading);
      try {
        const result = await api.addSectionFigure(
          paperId,
          heading,
          instruction,
          imageModel
        );
        invalidatePaperFigureBlob(paperId, result.image_path);
        if (result.content) {
          setNoteContent(result.content);
        } else {
          const saved = await api.fetchNote(paperId);
          setNoteContent(saved);
        }
        setPaper((p) =>
          p ? { ...p, has_note: true, note_version: result.note_version } : p
        );
        const modelLabel =
          effectiveImageModels.find((m) => m.id === result.image_model)?.label ||
          result.image_model ||
          imageModel;
        message.success(`已为「${result.heading || heading}」添加配图（${modelLabel}）`);
        setFigureModalHeading(null);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "配图失败");
      } finally {
        setSectionFigureLoading(null);
      }
    },
    [paperId, sectionFigureLoading, setNoteContent, imageModel, effectiveImageModels]
  );

  const handleDeleteFigure = useCallback(
    async (imagePath: string) => {
      if (deletingFigurePath) return;
      setDeletingFigurePath(imagePath);
      try {
        const result = await api.deleteNoteFigure(paperId, imagePath);
        invalidatePaperFigureBlob(paperId, imagePath);
        if (result.content) {
          setNoteContent(result.content);
        } else {
          const saved = await api.fetchNote(paperId);
          setNoteContent(saved);
        }
        setPaper((p) =>
          p ? { ...p, has_note: true, note_version: result.note_version } : p
        );
        message.success(
          result.file_deleted
            ? "配图与引用已删除"
            : result.removed_lines
              ? "已移除笔记中的配图引用"
              : "已移除引用"
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : "删除失败");
      } finally {
        setDeletingFigurePath(null);
      }
    },
    [paperId, deletingFigurePath, setNoteContent]
  );

  const handleSectionRefineReview = useCallback(
    (mergedContent: string, model: string) => {
      setRefineModalHeading(null);
      setRefineDiffSource("section");
      setRefineOldContent(noteContent);
      setRefineNewContent(mergedContent);
      setRefineModel(model);
      setRefineLoading(false);
      setRefineOpen(true);
    },
    [noteContent]
  );

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
    setNoteDraft(noteContent);
    setNoteEditing(true);
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
    setRefineOldContent(noteContent);
    setRefineDiffSource("chat");
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
      const result = await api.applyRefinedNote(paperId, content, {
        model: refineModel || undefined,
      });
      const saved = await api.fetchNote(paperId);
      setNoteContent(saved);
      setPaper((p) =>
        p ? { ...p, has_note: true, note_version: result.note_version } : p
      );
      setRefineOpen(false);
      message.success(refineDiffSource === "section" ? "本节润色已保存" : "笔记已保存");
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

  const activeNoteModelLabel = isNoting
    ? generatingModelLabel || modelLabel(noteModels, noteModel)
    : paper.note_model_label;

  const showSectionActions =
    canEditNote && !noteEditing && !noteStreaming && !isNoting;

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
              content={noteDisplayContent}
              paperId={paperId}
              contentRevision={noteFigureSignature}
              streaming={noteStreaming}
              sectionActions={showSectionActions}
              onAddSectionFigure={(heading) => setFigureModalHeading(heading)}
              onRefineSection={(heading) => {
                setRefineOldContent(noteContent);
                setRefineModalHeading(heading);
              }}
              sectionFigureLoadingHeading={sectionFigureLoading}
              onDeleteFigure={(path) => void handleDeleteFigure(path)}
              deletingFigurePath={deletingFigurePath}
            />
          </>
        ) : (
          <div className="note-empty-state">
            {paper.status === "parsed" && !isParsing ? (
              <>
                <p>解析已完成，可开始生成解读笔记。</p>
                <Button type="primary" onClick={() => void handleGenerateNote()}>
                  生成解读笔记
                </Button>
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
      {showNote && noteModels.length > 0 && (
        <ModelSwitcher
          models={noteModels}
          value={noteModel}
          onChange={handleNoteModelChange}
          compact
          mcpSearchAvailable={mcpSearchAvailable}
        />
      )}
      {showNote && effectiveImageModels.length > 0 && (
        <ImageModelPicker
          options={effectiveImageModels}
          value={imageModel}
          onChange={handleImageModelChange}
          compact
          label="配图"
        />
      )}
      {canEditNote && showNote && (
        <>
          <Tooltip title="手动编辑 Markdown">
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
          getPopupContainer={() => document.body}
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
      <Dropdown
        trigger={["click"]}
        getPopupContainer={() => document.body}
        menu={{ items: moreMenuItems }}
      >
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
                : chatFullscreen
                  ? " paper-page-root--chat-fullscreen"
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
                    <div className="paper-compare-pane-scroll-wrap">
                      <div className="paper-compare-pane-content">
                        <PdfViewer url={pdfUrl} />
                      </div>
                    </div>
                  </div>
                )}
                {showMd && (
                  <div className="paper-compare-pane">
                    <div className="paper-compare-pane-header">
                      <span className="paper-compare-pane-label">解析 Markdown</span>
                      {markdown && !loadingMd && (
                        <div className="paper-md-header-actions">
                          <Segmented
                            size="small"
                            className="paper-md-mode-switch"
                            value={mdViewMode}
                            onChange={(v) => setMdViewMode(v as MdViewMode)}
                            options={[
                              { label: "预览", value: "preview" },
                              { label: "中文翻译", value: "translation" },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    <div className="paper-compare-pane-scroll-wrap">
                      <div className="paper-compare-pane-content">
                        {loadingMd ? (
                          <div className="paper-compare-pane-loading">
                            <Spin />
                          </div>
                        ) : markdown ? (
                          mdViewMode === "translation" ? (
                            loadingMdTranslation ? (
                              <div className="paper-compare-pane-loading">
                                <Spin tip="加载中…" />
                              </div>
                            ) : translatingMd || mdTranslation ? (
                              <div className="paper-md-translation-stream">
                                {translatingMd && mdTranslateProgress ? (
                                  <p className="paper-md-translate-progress">
                                    正在翻译第 {mdTranslateProgress.chunk}/
                                    {mdTranslateProgress.total} 段…
                                  </p>
                                ) : null}
                                <NoteRenderer
                                  content={mdTranslationDisplay}
                                  paperId={paperId}
                                  streaming={translatingMd}
                                />
                              </div>
                            ) : (
                              <div className="paper-md-translate-empty">
                                <p>将 MinerU 解析结果翻译为中文 Markdown</p>
                                <div className="paper-md-translate-form">
                                  <span>翻译模型</span>
                                  <Select
                                    size="small"
                                    value={mdTranslateModel}
                                    style={{ minWidth: 180 }}
                                    options={[
                                      {
                                        value: MD_TRANSLATE_MODEL,
                                        label: MD_TRANSLATE_MODEL_LABEL,
                                      },
                                    ]}
                                    onChange={setMdTranslateModel}
                                  />
                                  <Button
                                    type="primary"
                                    loading={translatingMd}
                                    onClick={() => void handleTranslateMarkdown()}
                                  >
                                    生成中文翻译
                                  </Button>
                                </div>
                              </div>
                            )
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
                  </div>
                )}
                {showNote && (
                  <div className="paper-compare-pane paper-compare-pane--note">
                    <div className="paper-compare-pane-label">解读笔记</div>
                    <div className="paper-compare-pane-scroll-wrap">
                      <div
                        className="paper-compare-pane-content"
                        ref={bindNotePaneContainer}
                        onScroll={handleNotePaneScroll}
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
              onToggleCollapsed={() => {
                setChatCollapsed((v) => {
                  if (!v) setChatFullscreen(false);
                  return !v;
                });
              }}
              fullscreen={chatFullscreen}
              onToggleFullscreen={() => setChatFullscreen((v) => !v)}
              enabled
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
        title={refineDiffSource === "section" ? "小节润色预览" : undefined}
        applyLabel={refineDiffSource === "section" ? "确认保存本节" : undefined}
        defaultHunkDecision={refineDiffSource === "section" ? "accept" : "pending"}
        onApply={(merged) => void handleApplyRefinedNote(merged)}
        onCancel={handleCancelRefine}
      />

      <SectionFigureModal
        open={figureModalHeading != null}
        heading={figureModalHeading || ""}
        loading={sectionFigureLoading != null}
        imageModels={effectiveImageModels}
        imageModel={imageModel}
        onImageModelChange={handleImageModelChange}
        onCancel={() => {
          if (!sectionFigureLoading) setFigureModalHeading(null);
        }}
        onSubmit={(instruction) => {
          if (figureModalHeading) {
            void handleAddSectionFigure(figureModalHeading, instruction);
          }
        }}
      />

      <SectionRefineModal
        open={refineModalHeading != null}
        paperId={paperId}
        heading={refineModalHeading || ""}
        noteContent={noteContent}
        onCancel={() => setRefineModalHeading(null)}
        onReviewReady={handleSectionRefineReview}
      />

    </WorkspaceShell>
  );
}
