import { useCallback, useEffect, useRef, type UIEvent } from "react";
import { api, getToken } from "../api/client";

const STORAGE_PREFIX = "yanxi_note_read_";
const DEBOUNCE_MS = 3000;

export function calcScrollDepth(el: HTMLElement): number {
  const scrollable = el.scrollHeight - el.clientHeight;
  if (scrollable <= 0) return 100;
  const depth = (el.scrollTop / scrollable) * 100;
  return Math.min(100, Math.max(0, Math.round(depth)));
}

type StoredProgress = {
  paperId: number;
  progress: number;
  scrollTop: number;
  noteReadEpoch: number;
  updatedAt: number;
};

function storageKey(paperId: number): string {
  return `${STORAGE_PREFIX}${paperId}`;
}

function readLocal(paperId: number): StoredProgress | null {
  try {
    const raw = localStorage.getItem(storageKey(paperId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredProgress;
  } catch {
    return null;
  }
}

function writeLocal(data: StoredProgress): void {
  localStorage.setItem(storageKey(data.paperId), JSON.stringify(data));
}

interface Options {
  paperId: number;
  noteReadEpoch: number;
  initialScrollTop: number;
  enabled: boolean;
}

export function useNoteReadProgress({
  paperId,
  noteReadEpoch,
  initialScrollTop,
  enabled,
}: Options) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);
  const latestRef = useRef({
    progress: 0,
    scrollTop: 0,
    noteReadEpoch,
  });

  const flushToServer = useCallback(
    async (immediate = false) => {
      if (!enabled || paperId <= 0) return;
      const { progress, scrollTop, noteReadEpoch: epoch } = latestRef.current;
      if (epoch < noteReadEpoch) return;

      const send = () => {
        void api
          .updateNoteReadProgress(paperId, {
            progress,
            scroll_top: scrollTop,
            note_read_epoch: epoch,
          })
          .catch(() => {});
      };

      if (immediate) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        send();
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(send, DEBOUNCE_MS);
    },
    [enabled, paperId, noteReadEpoch]
  );

  const persist = useCallback(
    (el: HTMLElement) => {
      if (!enabled) return;
      const progress = calcScrollDepth(el);
      const scrollTop = Math.round(el.scrollTop);
      const local = readLocal(paperId);
      const baseProgress =
        local && local.noteReadEpoch === noteReadEpoch ? local.progress : 0;
      const nextProgress = Math.max(baseProgress, progress);
      const nextScrollTop = Math.max(
        local && local.noteReadEpoch === noteReadEpoch ? local.scrollTop : 0,
        scrollTop
      );

      latestRef.current = {
        progress: nextProgress,
        scrollTop: nextScrollTop,
        noteReadEpoch,
      };
      writeLocal({
        paperId,
        progress: nextProgress,
        scrollTop: nextScrollTop,
        noteReadEpoch,
        updatedAt: Date.now(),
      });
      flushToServer(false);
    },
    [enabled, flushToServer, noteReadEpoch, paperId]
  );

  const handleScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      if (!enabled) return;
      persist(e.currentTarget);
    },
    [enabled, persist]
  );

  const restoreScroll = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !enabled || restoredRef.current) return;
      const local = readLocal(paperId);
      let target = initialScrollTop;
      if (local && local.noteReadEpoch === noteReadEpoch) {
        target = Math.max(target, local.scrollTop);
      }
      if (target <= 0 || latestRef.current.progress >= 100) return;
      restoredRef.current = true;
      requestAnimationFrame(() => {
        el.scrollTo({ top: target, behavior: "auto" });
      });
    },
    [enabled, initialScrollTop, noteReadEpoch, paperId]
  );

  useEffect(() => {
    restoredRef.current = false;
    latestRef.current.noteReadEpoch = noteReadEpoch;
    const local = readLocal(paperId);
    if (local && local.noteReadEpoch === noteReadEpoch) {
      latestRef.current.progress = local.progress;
      latestRef.current.scrollTop = local.scrollTop;
    } else if (local && local.noteReadEpoch !== noteReadEpoch) {
      localStorage.removeItem(storageKey(paperId));
      latestRef.current.progress = 0;
      latestRef.current.scrollTop = 0;
    }
  }, [paperId, noteReadEpoch]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (!enabled || paperId <= 0) return;
      const token = getToken();
      const { progress, scrollTop, noteReadEpoch: epoch } = latestRef.current;
      const url = `/api/papers/${paperId}/note-read-progress`;
      fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          progress,
          scroll_top: scrollTop,
          note_read_epoch: epoch,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushToServer(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, flushToServer, paperId]);

  return { handleScroll, restoreScroll };
}
