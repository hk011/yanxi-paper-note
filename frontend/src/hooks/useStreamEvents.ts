import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialSectionProgress,
  NOTE_SECTIONS,
} from "../constants/noteSections";
import type {
  NotePipelinePhase,
  SectionRunStatus,
  StreamEvent,
  TimelineItem,
  ToolTraceItem,
} from "../types/events";
import {
  extractHitsFromToolOutput,
  mergeSearchHits,
} from "../utils/searchHits";

function mergeHits(
  existing: unknown[] | undefined,
  incoming: unknown[] | undefined
) {
  return mergeSearchHits(existing, incoming);
}

function matchesWebSearchTarget(
  t: { callId?: string; key?: string; tool?: string },
  ev: StreamEvent
) {
  return (
    (!!ev.call_id &&
      (t.callId === ev.call_id || t.key === ev.call_id)) ||
    (ev.tool === "web_search" && t.tool === "web_search")
  );
}

function resolveTimelineKey(ev: StreamEvent): string {
  if (ev.section_id) return ev.section_id;
  if (ev.phase === "outline") return "_outline";
  if (ev.phase === "final") return "_final";
  return "default";
}

interface StoredPipelineState {
  timeline: TimelineItem[];
  sectionTimelines: Record<string, TimelineItem[]>;
  sectionProgress: Record<string, SectionRunStatus>;
  pipelinePhase: NotePipelinePhase;
  outlineStatus: SectionRunStatus;
  finalStatus: SectionRunStatus;
}

function emptyPipelineState(): StoredPipelineState {
  return {
    timeline: [],
    sectionTimelines: {},
    sectionProgress: createInitialSectionProgress(),
    pipelinePhase: "",
    outlineStatus: "pending",
    finalStatus: "pending",
  };
}

function loadPipelineState(storageKey?: string): StoredPipelineState {
  if (!storageKey) return emptyPipelineState();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return emptyPipelineState();
    const parsed = JSON.parse(raw) as Partial<StoredPipelineState>;
    const state: StoredPipelineState = {
      ...emptyPipelineState(),
      ...parsed,
      sectionProgress: {
        ...createInitialSectionProgress(),
        ...(parsed.sectionProgress || {}),
      },
    };
    return normalizeCompletedPipelineState(state);
  } catch {
    return emptyPipelineState();
  }
}

function normalizeCompletedPipelineState(
  state: StoredPipelineState
): StoredPipelineState {
  const allSectionsDone = NOTE_SECTIONS.every(
    (section) => state.sectionProgress[section.id] === "done"
  );
  const hasFinalTrace = (state.sectionTimelines._final || []).length > 0;
  if (
    state.outlineStatus === "done" &&
    allSectionsDone &&
    hasFinalTrace &&
    state.finalStatus !== "done"
  ) {
    return {
      ...state,
      finalStatus: "done",
      pipelinePhase: "",
    };
  }
  return state;
}

function savePipelineState(storageKey: string | undefined, state: StoredPipelineState) {
  if (!storageKey) return;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

export function useStreamEvents(storageKey?: string) {
  const initial = loadPipelineState(storageKey);
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<ToolTraceItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>(initial.timeline);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [section, setSection] = useState("");
  const [pipelinePhase, setPipelinePhase] = useState<NotePipelinePhase>(
    initial.pipelinePhase
  );
  const [outlineStatus, setOutlineStatus] = useState<SectionRunStatus>(
    initial.outlineStatus
  );
  const [finalStatus, setFinalStatus] = useState<SectionRunStatus>(
    initial.finalStatus
  );
  const [sectionProgress, setSectionProgress] = useState<
    Record<string, SectionRunStatus>
  >(initial.sectionProgress);
  const [sectionTimelines, setSectionTimelines] = useState<
    Record<string, TimelineItem[]>
  >(initial.sectionTimelines);

  const toolsRef = useRef<ToolTraceItem[]>([]);
  const timelineRef = useRef<TimelineItem[]>(initial.timeline);
  const sectionTimelinesRef = useRef<Record<string, TimelineItem[]>>({
    ...initial.sectionTimelines,
  });
  const storageKeyRef = useRef(storageKey);
  const pipelineStateRef = useRef({
    sectionProgress: initial.sectionProgress,
    pipelinePhase: initial.pipelinePhase,
    outlineStatus: initial.outlineStatus,
    finalStatus: initial.finalStatus,
  });

  const persistPipelineState = useCallback(() => {
    if (!storageKey) return;
    savePipelineState(storageKey, {
      timeline: timelineRef.current,
      sectionTimelines: sectionTimelinesRef.current,
      ...pipelineStateRef.current,
    });
  }, [storageKey]);

  const getTimelineItems = useCallback((key: string) => {
    if (!sectionTimelinesRef.current[key]) {
      sectionTimelinesRef.current[key] = [];
    }
    return sectionTimelinesRef.current[key];
  }, []);

  const commitTimelineKey = useCallback(
    (key: string, items: TimelineItem[]) => {
      sectionTimelinesRef.current[key] = items;
      setSectionTimelines({ ...sectionTimelinesRef.current });
      if (key === "default" || key === "_final" || key === "_outline") {
        timelineRef.current = items;
        setTimeline([...items]);
      }
      if (storageKey) {
        persistPipelineState();
      }
    },
    [persistPipelineState, storageKey]
  );

  const switchPaper = useCallback(() => {
    const next = loadPipelineState(storageKey);
    toolsRef.current = [];
    timelineRef.current = next.timeline;
    sectionTimelinesRef.current = { ...next.sectionTimelines };
    setThinking("");
    setTools([]);
    setTimeline(next.timeline);
    setContent("");
    setStatus("");
    setSection("");
    setPipelinePhase(next.pipelinePhase);
    setOutlineStatus(next.outlineStatus);
    setFinalStatus(next.finalStatus);
    setSectionProgress(next.sectionProgress);
    setSectionTimelines(next.sectionTimelines);
    pipelineStateRef.current = {
      sectionProgress: next.sectionProgress,
      pipelinePhase: next.pipelinePhase,
      outlineStatus: next.outlineStatus,
      finalStatus: next.finalStatus,
    };
  }, [storageKey]);

  useEffect(() => {
    if (storageKeyRef.current === storageKey) return;
    storageKeyRef.current = storageKey;
    switchPaper();
  }, [storageKey, switchPaper]);

  const reset = useCallback(() => {
    setThinking("");
    setTools([]);
    setTimeline([]);
    setContent("");
    setStatus("");
    setSection("");
    setPipelinePhase("");
    setOutlineStatus("pending");
    setFinalStatus("pending");
    setSectionProgress(createInitialSectionProgress());
    setSectionTimelines({});
    toolsRef.current = [];
    timelineRef.current = [];
    sectionTimelinesRef.current = {};
    pipelineStateRef.current = {
      sectionProgress: createInitialSectionProgress(),
      pipelinePhase: "",
      outlineStatus: "pending",
      finalStatus: "pending",
    };
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  const finalizeTimelineKey = useCallback(
    (key: string) => {
      const items = getTimelineItems(key);
      const next = items.map((t) =>
        t.status === "pending" ? { ...t, status: "success" as const } : t
      );
      const changed = next.some((t, i) => t.status !== items[i]?.status);
      if (changed) commitTimelineKey(key, next);
    },
    [commitTimelineKey, getTimelineItems]
  );

  const finalizeAllTimelines = useCallback(() => {
    for (const key of Object.keys(sectionTimelinesRef.current)) {
      finalizeTimelineKey(key);
    }
    finalizeTimelineKey("default");
  }, [finalizeTimelineKey]);

  const markPipelineComplete = useCallback(() => {
    const doneSections = Object.fromEntries(
      NOTE_SECTIONS.map((section) => [section.id, "done" as SectionRunStatus])
    ) as Record<string, SectionRunStatus>;
    pipelineStateRef.current = {
      outlineStatus: "done",
      finalStatus: "done",
      sectionProgress: doneSections,
      pipelinePhase: "",
    };
    setOutlineStatus("done");
    setFinalStatus("done");
    setSectionProgress(doneSections);
    setPipelinePhase("");
    finalizeAllTimelines();
    persistPipelineState();
  }, [finalizeAllTimelines, persistPipelineState]);

  const initPipelineProgress = useCallback(() => {
    const sectionProgress = createInitialSectionProgress();
    pipelineStateRef.current = {
      pipelinePhase: "outline",
      outlineStatus: "pending",
      finalStatus: "pending",
      sectionProgress,
    };
    setPipelinePhase("outline");
    setOutlineStatus("pending");
    setFinalStatus("pending");
    setSectionProgress(sectionProgress);
  }, []);

  const handleEvent = useCallback(
    (ev: StreamEvent) => {
      const shouldMarkPipelineComplete = () => {
        const ps = pipelineStateRef.current;
        return (
          ps.pipelinePhase !== "" ||
          ps.outlineStatus !== "pending" ||
          ps.finalStatus !== "pending"
        );
      };

      if (ev.type === "done") {
        finalizeAllTimelines();
        if (shouldMarkPipelineComplete()) {
          markPipelineComplete();
        }
        return ev;
      }

      if (ev.type === "status") {
        if (ev.status) setStatus(ev.status);
        if (ev.section) setSection(ev.section);

        if (ev.status === "noting" && ev.phase === "outline" && !ev.section_status) {
          initPipelineProgress();
        }

        if (ev.phase) {
          setPipelinePhase(ev.phase);
          pipelineStateRef.current.pipelinePhase = ev.phase;
        }

        if (ev.phase === "outline" && ev.section_status) {
          setOutlineStatus(ev.section_status);
          pipelineStateRef.current.outlineStatus = ev.section_status;
        }

        if (ev.phase === "final" && ev.section_status) {
          setFinalStatus(ev.section_status);
          pipelineStateRef.current.finalStatus = ev.section_status;
          if (ev.section_status === "done") {
            finalizeTimelineKey("_final");
            persistPipelineState();
          }
        }

        if (ev.phase === "draft" && ev.section_id && ev.section_status) {
          const nextSectionProgress = {
            ...pipelineStateRef.current.sectionProgress,
            [ev.section_id]: ev.section_status,
          };
          pipelineStateRef.current.sectionProgress = nextSectionProgress;
          setSectionProgress(nextSectionProgress);
        }

        if (ev.status === "done") {
          finalizeAllTimelines();
          if (shouldMarkPipelineComplete()) {
            markPipelineComplete();
          }
        } else if (ev.status === "failed") {
          finalizeAllTimelines();
        }
        if (ev.parsed_pages != null || ev.total_pages != null) {
          return ev;
        }
      }

      const timelineKey = resolveTimelineKey(ev);

      if (ev.type === "thinking" && ev.delta) {
        setThinking((t) => t + ev.delta!);
        const items = getTimelineItems(timelineKey);
        const last = items[items.length - 1];
        if (last?.kind === "thinking" && last.status === "pending") {
          last.content = `${last.content ?? ""}${ev.delta}`;
          commitTimelineKey(timelineKey, [...items]);
        } else {
          commitTimelineKey(timelineKey, [
            ...items,
            {
              key: `thinking-${timelineKey}-${Date.now()}-${items.length}`,
              kind: "thinking",
              status: "pending",
              content: ev.delta,
            },
          ]);
        }
      }

      if (ev.type === "tool_start") {
        const items = getTimelineItems(timelineKey);
        const last = items[items.length - 1];
        if (last?.kind === "thinking" && last.status === "pending") {
          last.status = "success";
        }
        const item: ToolTraceItem = {
          key: ev.call_id || `${ev.tool}-${Date.now()}`,
          tool: ev.tool || "tool",
          callId: ev.call_id || "",
          status: "pending",
          title: ev.tool || "",
          input: ev.input,
          description:
            ev.tool === "web_search"
              ? "正在检索…"
              : ev.tool === "gen_figure"
                ? "正在生成说明图…"
                : undefined,
        };
        if (timelineKey === "default") {
          toolsRef.current = [...toolsRef.current, item];
          setTools([...toolsRef.current]);
        }
        commitTimelineKey(timelineKey, [
          ...items,
          {
            key: item.key,
            kind: "tool",
            status: "pending",
            tool: item.tool,
            callId: item.callId,
            input: item.input,
            content: item.description,
          },
        ]);
      }

      if (ev.type === "tool_delta") {
        const items = getTimelineItems(timelineKey);
        const q = ev.query as string | undefined;
        const findTarget = (t: { callId?: string; key?: string; tool?: string }) =>
          matchesWebSearchTarget(t, ev) ||
          t.callId === ev.call_id ||
          t.key === ev.call_id;

        if (timelineKey === "default") {
          toolsRef.current = toolsRef.current.map((t) =>
            findTarget(t)
              ? {
                  ...t,
                  description: q ? `搜索：${q}` : t.description,
                  content: q ? `搜索：${q}` : t.content,
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(t.hits, ev.hits),
                }
              : t
          );
          setTools([...toolsRef.current]);
        }

        commitTimelineKey(
          timelineKey,
          items.map((t) =>
            t.kind === "tool" && findTarget(t)
              ? {
                  ...t,
                  content: q ? `搜索：${q}` : t.content,
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(t.hits, ev.hits),
                }
              : t
          )
        );
      }

      if (ev.type === "references" && Array.isArray(ev.items)) {
        const items = getTimelineItems(timelineKey);
        const q = ev.query as string | undefined;
        const findTarget = (t: { callId?: string; key?: string; tool?: string }) =>
          matchesWebSearchTarget(t, ev) || t.tool === "web_search";

        if (timelineKey === "default") {
          toolsRef.current = toolsRef.current.map((t) =>
            findTarget(t)
              ? {
                  ...t,
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(t.hits, ev.items),
                }
              : t
          );
          setTools([...toolsRef.current]);
        }

        commitTimelineKey(
          timelineKey,
          items.map((t) =>
            t.kind === "tool" && findTarget(t)
              ? {
                  ...t,
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(t.hits, ev.items),
                }
              : t
          )
        );
      }

      if (ev.type === "tool_end") {
        const items = getTimelineItems(timelineKey);
        const q = ev.query as string | undefined;
        const parsedOutput =
          typeof ev.output === "string"
            ? (() => {
                try {
                  return JSON.parse(ev.output) as Record<string, unknown>;
                } catch {
                  return null;
                }
              })()
            : (ev.output as Record<string, unknown> | null);
        const outputHits = extractHitsFromToolOutput(parsedOutput ?? ev.output);
        const matchesToolEnd = (t: {
          callId?: string;
          key?: string;
          tool?: string;
          status?: string;
        }) =>
          matchesWebSearchTarget(t, ev) ||
          t.callId === ev.call_id ||
          t.key === ev.call_id ||
          (ev.tool === "gen_figure" &&
            t.tool === "gen_figure" &&
            t.status === "pending");

        if (timelineKey === "default") {
          toolsRef.current = toolsRef.current.map((t) =>
            matchesToolEnd(t)
              ? {
                  ...t,
                  status: ev.status === "success" ? "success" : "error",
                  description: t.status === "pending" ? "完成" : t.description,
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(mergeHits(t.hits, ev.hits), outputHits),
                  content:
                    ev.tool === "web_search" && q
                      ? `搜索：${q}`
                      : typeof ev.output === "string"
                        ? ev.output
                        : ev.output && ev.tool !== "web_search"
                          ? JSON.stringify(ev.output, null, 2)
                          : t.content,
                }
              : t
          );
          setTools([...toolsRef.current]);
        }

        commitTimelineKey(
          timelineKey,
          items.map((t) =>
            t.kind === "tool" && matchesToolEnd(t)
              ? {
                  ...t,
                  status: ev.status === "success" ? "success" : "error",
                  input: q ? { ...(t.input || {}), query: q } : t.input,
                  hits: mergeHits(mergeHits(t.hits, ev.hits), outputHits),
                  output: parsedOutput ?? ev.output,
                }
              : t
          )
        );
      }

      if (ev.type === "content" && ev.delta) {
        const bucketItems = getTimelineItems(timelineKey);
        const lastThinking = [...bucketItems]
          .reverse()
          .find((t) => t.kind === "thinking" && t.status === "pending");
        if (lastThinking) {
          lastThinking.status = "success";
          commitTimelineKey(timelineKey, [...bucketItems]);
        }
        if (ev.snapshot) {
          setContent(ev.delta);
        } else {
          setContent((c) => c + ev.delta!);
        }
      }

      return ev;
    },
    [
      commitTimelineKey,
      finalizeAllTimelines,
      finalizeTimelineKey,
      getTimelineItems,
      initPipelineProgress,
      markPipelineComplete,
      persistPipelineState,
    ]
  );

  return {
    thinking,
    tools,
    timeline,
    content,
    status,
    section,
    pipelinePhase,
    outlineStatus,
    finalStatus,
    sectionProgress,
    sectionTimelines,
    reset,
    switchPaper,
    handleEvent,
    setContent,
    noteSections: NOTE_SECTIONS,
  };
}
