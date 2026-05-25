import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble, Prompts, Sender, Welcome } from "@ant-design/x";
import type { BubbleListRef } from "@ant-design/x/es/bubble/interface";
import type { AttachmentsProps } from "@ant-design/x";
import {
  CommentOutlined,
  CompressOutlined,
  HistoryOutlined,
  MergeCellsOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { Avatar, message as antMessage, Spin, Tooltip, Typography } from "antd";
import {
  api,
  buildAuthenticatedUrl,
  ChatConversationSummary,
  ChatSuggestion,
  ModelOption,
  subscribeChatStream,
} from "../api/client";
import ChatFeatureToggles from "./ChatFeatureToggles";
import ChatImageAttachments from "./ChatImageAttachments";
import ContextRing from "./ContextRing";
import DraggableChatFab from "./DraggableChatFab";
import MarkdownPreview from "./MarkdownPreview";
import ModelSwitcher, { isCustomModel } from "./ModelSwitcher";
import ThoughtTimeline from "./ThoughtTimeline";
import YanxiLogo from "./YanxiLogo";
import { useStreamEvents } from "../hooks/useStreamEvents";
import { useStickToBottom } from "../hooks/useStickToBottom";
import ScrollToBottomButton from "./ScrollToBottomButton";
import type { StreamEvent, TimelineItem } from "../types/events";
import { timelineFromAssistantMessage } from "../utils/messageTimeline";
import { collectGenFigurePreviews } from "../utils/figureOutput";

const { Text } = Typography;

function chatModelKey(paperId: number) {
  return `yanxi:chat-model:${paperId}`;
}

function chatConvKey(paperId: number) {
  return `yanxi:chat-conv:${paperId}`;
}

interface Props {
  paperId: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  enabled: boolean;
  onRefineTurn?: (
    assistantMessageId: number,
    conversationId: number,
    model: string
  ) => void;
  onRefineConversation?: (conversationId: number, model: string) => void;
  refining?: boolean;
}

interface UiMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  attachments?: { path: string; name?: string; url?: string }[];
  references?: unknown[];
  thoughtTimeline?: TimelineItem[];
  streaming?: boolean;
}

function mapApiMessage(m: {
  id: number;
  role: string;
  content: string;
  reasoning_content?: string;
  had_tool_call?: boolean;
  references?: unknown[];
  tool_trace?: unknown[];
  attachments?: { path: string; name?: string; url?: string }[];
}): UiMessage {
  const role = m.role as "user" | "assistant";
  return {
    id: m.id,
    role,
    content: m.content,
    attachments: m.attachments,
    references: m.references,
    thoughtTimeline:
      role === "assistant"
        ? timelineFromAssistantMessage(m.id, m)
        : undefined,
  };
}

export default function ChatPanel({
  paperId,
  collapsed,
  onToggleCollapsed,
  enabled,
  onRefineTurn,
  onRefineConversation,
  refining,
}: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [mcpSearchAvailable, setMcpSearchAvailable] = useState(false);
  const [model, setModel] = useState("");
  const [contextLimit, setContextLimit] = useState(256000);
  const [promptTokens, setPromptTokens] = useState(0);
  const [enableThinking, setEnableThinking] = useState(true);
  const [enableSearch, setEnableSearch] = useState(false);
  const [enableFigureGen, setEnableFigureGen] = useState(false);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<NonNullable<AttachmentsProps["items"]>>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const modelInitializedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const bubbleListRef = useRef<BubbleListRef>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamContentRef = useRef("");
  const timelineSnapshotRef = useRef<TimelineItem[]>([]);

  const stream = useStreamEvents();
  const { handleEvent, reset: resetStream, timeline, content: streamContent } = stream;

  const {
    handleScroll: handleStickScroll,
    jumpToBottom: jumpChatToBottom,
    showScrollToBottom: showChatScrollToBottom,
  } = useStickToBottom({
    enabled: true,
    contentDeps: [messages, streamContent, timeline.length, loading],
  });

  useEffect(() => {
    streamContentRef.current = streamContent;
  }, [streamContent]);

  useEffect(() => {
    timelineSnapshotRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    if (!streamingIdRef.current) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== streamingIdRef.current) return m;
        return {
          ...m,
          content: streamContent,
          streaming: loading,
          thoughtTimeline:
            timeline.length > 0 ? timeline : m.thoughtTimeline,
        };
      })
    );
  }, [streamContent, loading, timeline]);

  const refreshConversation = useCallback(async (convId?: number | null) => {
    const id = convId ?? conversationId;
    if (id == null) return;
    try {
      const conv = await api.getChatConversation(paperId, id);
      setMessages(conv.messages.map(mapApiMessage));
      const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) {
        setPromptTokens(
          (lastAssistant.prompt_tokens || 0) + (lastAssistant.completion_tokens || 0)
        );
      } else {
        setPromptTokens(0);
      }
    } catch {
      /* 刷新失败时保留当前界面状态 */
    }
  }, [paperId, conversationId]);

  const loadConversations = useCallback(async () => {
    const list = await api.listChatConversations(paperId);
    setConversations(list.items);
    return list;
  }, [paperId]);

  const switchConversation = useCallback(
    async (convId: number) => {
      if (loading) return;
      abortRef.current?.();
      setConversationId(convId);
      localStorage.setItem(chatConvKey(paperId), String(convId));
      setHistoryOpen(false);
      resetStream();
      setInput("");
      setAttachments([]);
      await refreshConversation(convId);
      const conv = await api.getChatConversation(paperId, convId);
      if (conv.messages.length === 0) {
        const sug = await api.getChatSuggestions(paperId);
        setSuggestions(sug.items.slice(0, 3));
      } else {
        setSuggestions([]);
      }
    },
    [loading, paperId, refreshConversation, resetStream]
  );

  const loadBootstrap = useCallback(async () => {
    setBootLoading(true);
    try {
      const [config, convList, sug] = await Promise.all([
        api.getChatConfig(paperId),
        loadConversations(),
        api.getChatSuggestions(paperId),
      ]);
      setModels(config.models);
      setContextLimit(config.context_limit);
      setMcpSearchAvailable(Boolean(config.mcp_search_available));

      const savedConv = localStorage.getItem(chatConvKey(paperId));
      const savedConvId = savedConv ? Number(savedConv) : NaN;
      const pickConvId =
        (Number.isFinite(savedConvId) &&
          convList.items.some((c) => c.id === savedConvId) &&
          savedConvId) ||
        convList.active_id ||
        convList.items[0]?.id ||
        null;

      if (pickConvId == null) {
        const created = await api.createChatConversation(paperId);
        setConversationId(created.id);
        localStorage.setItem(chatConvKey(paperId), String(created.id));
        setMessages([]);
        setSuggestions(sug.items.slice(0, 3));
        await loadConversations();
      } else {
        setConversationId(pickConvId);
        const conv = await api.getChatConversation(paperId, pickConvId);
        setMessages(conv.messages.map(mapApiMessage));
        setSuggestions(conv.messages.length === 0 ? sug.items.slice(0, 3) : []);
        const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          setPromptTokens(
            (lastAssistant.prompt_tokens || 0) + (lastAssistant.completion_tokens || 0)
          );
        }
      }

      if (!modelInitializedRef.current) {
        const saved = localStorage.getItem(chatModelKey(paperId));
        const conv =
          pickConvId != null
            ? await api.getChatConversation(paperId, pickConvId)
            : { messages: [] as { role: string; model?: string }[] };
        const lastAssistant = [...conv.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        const modelIds = config.models.map((m) => m.id);
        const pick =
          (saved && modelIds.includes(saved) && saved) ||
          (lastAssistant?.model && modelIds.includes(lastAssistant.model)
            ? lastAssistant.model
            : null) ||
          config.default_model;
        setModel(pick);
        modelInitializedRef.current = true;
      }
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : "加载问答失败");
    } finally {
      setBootLoading(false);
    }
  }, [paperId, loadConversations]);

  const handleModelChange = useCallback(
    (next: string) => {
      setModel(next);
      localStorage.setItem(chatModelKey(paperId), next);
      if (isCustomModel(models, next)) {
        setEnableSearch(false);
      }
    },
    [paperId, models]
  );

  const customModelSelected = isCustomModel(models, model);
  const searchDisabled = customModelSelected && !mcpSearchAvailable;

  useEffect(() => {
    if (searchDisabled && enableSearch) {
      setEnableSearch(false);
    }
  }, [searchDisabled, enableSearch]);

  useEffect(() => {
    if (!enabled) return;
    modelInitializedRef.current = false;
    abortRef.current?.();
    void loadBootstrap();
    return () => abortRef.current?.();
  }, [enabled, loadBootstrap, paperId]);

  const handleBubbleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      handleStickScroll(e);
      const el = e.currentTarget;
      const canScroll = el.scrollHeight > el.clientHeight + 4;
      if (!canScroll) {
        setShowScrollTop(false);
        return;
      }
      const isReverse = getComputedStyle(el).flexDirection === "column-reverse";
      setShowScrollTop(isReverse ? el.scrollTop < -60 : el.scrollTop > 60);
    },
    [handleStickScroll]
  );

  const scrollChatToTop = useCallback(() => {
    bubbleListRef.current?.scrollTo({ top: "top", behavior: "smooth" });
  }, []);

  const handleRefineWholeConversation = useCallback(() => {
    if (conversationId == null || !model) return;
    onRefineConversation?.(conversationId, model);
  }, [conversationId, model, onRefineConversation]);

  const finalizeActiveStream = useCallback(
    (aborted = false) => {
      const assistantId = streamingIdRef.current;
      setLoading(false);
      streamingIdRef.current = null;
      if (!assistantId) return;
      const fullText = streamContentRef.current || "";
      const thoughtSnapshot = [...timelineSnapshotRef.current];
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          const partial = fullText.trim();
          return {
            ...m,
            content:
              partial.length > 0
                ? fullText
                : aborted
                  ? "（已停止生成）"
                  : m.content,
            streaming: false,
            thoughtTimeline:
              thoughtSnapshot.length > 0 ? thoughtSnapshot : m.thoughtTimeline,
          };
        })
      );
    },
    []
  );

  const handleStopGeneration = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    finalizeActiveStream(true);
  }, [finalizeActiveStream]);

  const handleStreamEvent = useCallback(
    (ev: StreamEvent) => {
      handleEvent(ev);
      if (ev.type === "usage") {
        const total = (ev.prompt_tokens || 0) + (ev.completion_tokens || 0);
        if (total > 0) setPromptTokens(total);
      }
      if (ev.type === "suggestions" && Array.isArray(ev.items)) {
        const items = (ev.items as { key?: string; label?: string }[])
          .filter((x) => x?.label)
          .slice(0, 3)
          .map((x, i) => ({
            key: String(x.key || `sug-${i}`),
            label: String(x.label),
          }));
        if (items.length > 0) setSuggestions(items);
      }
      if (ev.type === "status" && ev.status === "failed") {
        antMessage.error(ev.error || "回答失败");
      }
    },
    [handleEvent]
  );

  const uploadAttachment = async (file: File) => {
    const result = await api.uploadChatImage(paperId, file);
    return result;
  };

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading || conversationId == null) return;

    const pendingAttachments = attachments
      .filter((a) => a.status === "done")
      .map((a) => ({
        path: (a.response as { path?: string } | undefined)?.path || "",
        name: a.name,
        url: (a.response as { url?: string } | undefined)?.url,
      }))
      .filter((a) => a.path);

    const userMsg: UiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      attachments: pendingAttachments,
    };
    const assistantId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setAttachments([]);
    setSuggestions([]);
    setLoading(true);
    resetStream();
    streamingIdRef.current = assistantId;

    abortRef.current?.();
    const streamPayload = {
      content,
      conversation_id: conversationId,
      model,
      enable_thinking: enableThinking,
      enable_search: enableSearch,
      enable_figure_gen: enableFigureGen,
      attachments: pendingAttachments.map(({ path, name }) => ({ path, name: name || "" })),
    };
    const onStreamDone = () => {
      finalizeActiveStream(false);
      void refreshConversation(conversationId);
      void loadConversations();
    };
    abortRef.current = subscribeChatStream(
      paperId,
      streamPayload,
      handleStreamEvent,
      onStreamDone
    );
  };

  const handleNewConversation = async () => {
    if (loading) return;
    try {
      abortRef.current?.();
      const created = await api.createChatConversation(paperId);
      setConversationId(created.id);
      localStorage.setItem(chatConvKey(paperId), String(created.id));
      setMessages([]);
      setPromptTokens(0);
      setInput("");
      setAttachments([]);
      resetStream();
      const sug = await api.getChatSuggestions(paperId);
      setSuggestions(sug.items.slice(0, 3));
      await loadConversations();
      setHistoryOpen(false);
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : "无法开启新对话");
    }
  };

  const handlePasteFile = async (file: File) => {
    const uid = `${Date.now()}-${file.name}`;
    setAttachments((prev) => [
      ...prev,
      {
        uid,
        name: file.name,
        status: "uploading",
        type: file.type,
      },
    ]);
    try {
      const result = await uploadAttachment(file);
      setAttachments((prev) =>
        prev.map((a) =>
          a.uid === uid
            ? {
                ...a,
                status: "done",
                url: buildAuthenticatedUrl(result.url),
                thumbUrl: buildAuthenticatedUrl(result.url),
                response: result,
              }
            : a
        )
      );
    } catch (e) {
      setAttachments((prev) => prev.filter((a) => a.uid !== uid));
      antMessage.error(e instanceof Error ? e.message : "图片上传失败");
    }
  };

  const promptItems = suggestions.map((s) => ({
    key: s.key,
    label: s.label,
    icon: <CommentOutlined />,
  }));

  const hasAssistantReply = messages.some(
    (m) => m.role === "assistant" && m.content.trim() && !m.streaming
  );
  const lastAssistantMessageId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && !m.streaming)?.id;
  const showRefineEntry =
    Boolean(onRefineConversation) &&
    hasAssistantReply &&
    conversationId != null;

  if (collapsed) {
    return <DraggableChatFab onClick={onToggleCollapsed} />;
  }

  return (
    <aside className="chat-panel">
      <div className="chat-panel-header">
        <div className="chat-panel-header-main">
          <YanxiLogo size={20} variant="sm" className="chat-panel-logo" />
          <span>论文问答</span>
        </div>
        <div className="chat-panel-header-actions">
          <button
            type="button"
            className="chat-history-btn"
            onClick={() => setHistoryOpen((v) => !v)}
            title="历史会话"
            aria-label="历史会话"
          >
            <HistoryOutlined />
          </button>
          <button
            type="button"
            className="chat-new-conversation-btn"
            onClick={() => void handleNewConversation()}
            disabled={loading}
          >
            <PlusOutlined />
            新对话
          </button>
          <button
            type="button"
            className="chat-panel-collapse-btn"
            onClick={onToggleCollapsed}
            title="收起为悬浮球"
            aria-label="收起为悬浮球"
          >
            <CompressOutlined />
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="chat-history-panel">
          {conversations.length === 0 ? (
            <Text type="secondary" className="chat-history-empty">
              暂无历史会话
            </Text>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                className={`chat-history-item${
                  conv.id === conversationId ? " chat-history-item--active" : ""
                }`}
                onClick={() => void switchConversation(conv.id)}
              >
                <span className="chat-history-item-title">{conv.title}</span>
                <span className="chat-history-item-meta">
                  {conv.message_count} 条 · {conv.preview || "空对话"}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="chat-panel-body-wrap">
        <div className="chat-panel-body" ref={listRef}>
        {bootLoading ? (
          <div className="chat-panel-loading">
            <Spin />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-panel-empty">
            <Welcome
              className="chat-welcome"
              icon={<YanxiLogo size={32} />}
              title="论文问答"
              description="针对论文和解读笔记提问、讨论。可开启「配图」生成说明图，并用「融入笔记」写入解读。"
            />
            {promptItems.length > 0 && (
              <Prompts
                title="试试这些问题"
                items={promptItems}
                vertical
                wrap={false}
                rootClassName="chat-suggestions"
                onItemClick={({ data }) => void handleSend(String(data.label || ""))}
              />
            )}
          </div>
        ) : (
          <Bubble.List
            ref={bubbleListRef}
            style={{ height: "100%" }}
            onScroll={handleBubbleScroll}
            role={{
              user: { placement: "end" },
              ai: {
                placement: "start",
                avatar: (
                  <Avatar
                    icon={<RobotOutlined />}
                    style={{ background: "#1677ff" }}
                    size="small"
                  />
                ),
                variant: "borderless",
              },
            }}
            items={messages.map((m) => {
              const isStreamingAssistant =
                m.role === "assistant" && m.streaming && m.id === streamingIdRef.current;
              const thoughtItems = isStreamingAssistant
                ? timeline
                : m.thoughtTimeline || [];
              const showThought = m.role === "assistant" && thoughtItems.length > 0;
              const showAnswer = m.content.length > 0;
              const bubbleRole = m.role === "assistant" ? "ai" : "user";
              const figurePreviews =
                m.role === "assistant"
                  ? collectGenFigurePreviews(thoughtItems, paperId)
                  : [];

              return {
                key: String(m.id),
                role: bubbleRole,
                content: m.content || (showThought ? " " : ""),
                loading:
                  isStreamingAssistant && !showThought && !showAnswer,
                header:
                  showThought || (isStreamingAssistant && figurePreviews.length > 0) ? (
                    <>
                      {showThought ? (
                        <ThoughtTimeline
                          items={thoughtItems}
                          active={isStreamingAssistant && loading}
                          paperId={paperId}
                          compact
                        />
                      ) : null}
                      {figurePreviews.length > 0 ? (
                        <div className="chat-gen-figure-previews chat-gen-figure-previews--inline">
                          {figurePreviews.map((fig, idx) => (
                            <div key={`${fig.src}-${idx}`} className="chat-gen-figure-card">
                              <img
                                src={fig.src}
                                alt="生成配图"
                                className="chat-gen-figure-thumb"
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : undefined,
                contentRender: (content: string) =>
                  bubbleRole === "ai" ? (
                    showAnswer ? (
                      <MarkdownPreview
                        content={String(content || "").trim()}
                        paperId={paperId}
                        className="chat-markdown"
                      />
                    ) : null
                  ) : (
                    <div className="chat-user-text">{String(content || "")}</div>
                  ),
                footer:
                  m.role === "assistant" && !m.streaming ? (
                    <div className="chat-assistant-actions">
                      {figurePreviews.length > 0 ? (
                        <div className="chat-gen-figure-previews">
                          {figurePreviews.map((fig, idx) => (
                            <div key={`${fig.src}-${idx}`} className="chat-gen-figure-card">
                              <img
                                src={fig.src}
                                alt="生成配图"
                                className="chat-gen-figure-thumb"
                              />
                              {fig.prompt ? (
                                <Text type="secondary" className="chat-gen-figure-caption">
                                  {fig.prompt.length > 80
                                    ? `${fig.prompt.slice(0, 80)}…`
                                    : fig.prompt}
                                </Text>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {m.id === lastAssistantMessageId &&
                      !loading &&
                      promptItems.length > 0 ? (
                        <div className="chat-followup-chips chat-followup-chips--vertical">
                          {promptItems.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              className="chat-followup-chip"
                              onClick={() => void handleSend(String(item.label || ""))}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {onRefineTurn &&
                      typeof m.id === "number" &&
                      m.content.trim() ? (
                        <button
                          type="button"
                          className="chat-refine-turn-btn"
                          disabled={refining || loading}
                          onClick={() =>
                            conversationId != null &&
                            model &&
                            onRefineTurn?.(m.id as number, conversationId, model)
                          }
                        >
                          <MergeCellsOutlined />
                          融入笔记
                        </button>
                      ) : null}
                      {m.references && m.references.length > 0 ? (
                        <div className="chat-references">
                          <Text type="secondary">参考来源</Text>
                          <div className="tool-link-list">
                            {(m.references as Record<string, string>[])
                              .slice(0, 5)
                              .map((ref, i) =>
                                ref.url ? (
                                  <a
                                    key={`${ref.url}-${i}`}
                                    className="tool-link-card"
                                    href={ref.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <span className="tool-link-index">{i + 1}</span>
                                    <span>
                                      <span className="tool-link-title">
                                        {ref.title || ref.url}
                                      </span>
                                    </span>
                                  </a>
                                ) : null
                              )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : undefined,
              };
            })}
          />
        )}
        </div>

        {showScrollTop && messages.length > 0 && (
          <Tooltip title="回到顶部">
            <button
              type="button"
              className="chat-scroll-top-btn"
              onClick={scrollChatToTop}
              aria-label="回到顶部"
            >
              <VerticalAlignTopOutlined />
            </button>
          </Tooltip>
        )}
        <ScrollToBottomButton
          visible={showChatScrollToBottom && (loading || messages.some((m) => m.streaming))}
          onClick={jumpChatToBottom}
          className="stick-scroll-bottom-btn chat-scroll-bottom-btn"
        />
      </div>

      <div className="chat-panel-footer">
        {showRefineEntry && !bootLoading && messages.length > 0 && (
          <button
            type="button"
            className="chat-refine-footer-chip"
            disabled={loading || refining}
            onClick={handleRefineWholeConversation}
          >
            <MergeCellsOutlined />
            {refining ? "融合中…" : "整段融入笔记"}
          </button>
        )}
        {(attachments.length > 0 || loading) && (
          <div className="chat-composer-bar">
            {attachments.length > 0 ? (
              <span className="chat-composer-bar-meta">
                <RightOutlined className="chat-composer-bar-chevron" />
                {attachments.length} 张图片
              </span>
            ) : (
              <span />
            )}
            {loading ? (
              <button
                type="button"
                className="chat-composer-stop"
                onClick={handleStopGeneration}
              >
                停止
              </button>
            ) : null}
          </div>
        )}

        <div
          className={`chat-composer${
            enableThinking || enableSearch || enableFigureGen ? " chat-composer--accent" : ""
          }`}
        >
          <Sender
            rootClassName="chat-composer-sender"
            value={input}
            onChange={setInput}
            loading={loading}
            autoSize={{ minRows: 1, maxRows: 6 }}
            placeholder="添加追问…"
            onSubmit={() => void handleSend()}
            onCancel={handleStopGeneration}
            onPasteFile={(files) => {
              const file = files[0];
              if (file) void handlePasteFile(file);
            }}
            header={
              <ChatImageAttachments
                items={attachments}
                onRemove={(uid) =>
                  setAttachments((prev) => prev.filter((a) => a.uid !== uid))
                }
              />
            }
            suffix={false}
            footer={(_, { components }) => (
              <div className="chat-composer-footer">
                <div className="chat-composer-footer-row">
                <div className="chat-composer-footer-left">
                  {models.length > 0 ? (
                    <ModelSwitcher
                      models={models}
                      value={model}
                      onChange={handleModelChange}
                      disabled={loading}
                      mcpSearchAvailable={mcpSearchAvailable}
                    />
                  ) : null}
                  <ChatFeatureToggles
                    compact
                    enableThinking={enableThinking}
                    enableSearch={enableSearch}
                    enableFigureGen={enableFigureGen}
                    onThinkingChange={setEnableThinking}
                    onSearchChange={setEnableSearch}
                    onFigureGenChange={setEnableFigureGen}
                    showFigureGen
                    disabled={loading}
                    searchDisabled={searchDisabled}
                    searchDisabledReason={
                      mcpSearchAvailable
                        ? "当前模型不支持联网搜索"
                        : "自定义模型需配置千帆 MCP 联网搜索（web_search_mcp_server_key）"
                    }
                  />
                </div>
                <div className="chat-composer-footer-right">
                  <ContextRing
                    minimal
                    used={promptTokens}
                    limit={contextLimit}
                    size={18}
                  />
                  <Tooltip title="添加图片">
                    <button
                      type="button"
                      className="chat-composer-icon-btn"
                      onClick={() => {
                        const inputEl = document.createElement("input");
                        inputEl.type = "file";
                        inputEl.accept = "image/*";
                        inputEl.onchange = () => {
                          const file = inputEl.files?.[0];
                          if (file) void handlePasteFile(file);
                        };
                        inputEl.click();
                      }}
                      aria-label="添加图片"
                    >
                      <PictureOutlined />
                    </button>
                  </Tooltip>
                  {loading ? (
                    <Tooltip title="停止生成">
                      <button
                        type="button"
                        className="chat-composer-stop-btn"
                        onClick={handleStopGeneration}
                        aria-label="停止生成"
                      >
                        <span className="chat-composer-stop-btn-inner" />
                      </button>
                    </Tooltip>
                  ) : (
                    <components.SendButton />
                  )}
                </div>
                </div>
              </div>
            )}
          />
        </div>
      </div>
    </aside>
  );
}
