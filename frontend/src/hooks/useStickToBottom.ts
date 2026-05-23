import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";

interface Options {
  /** 为 false 时不跟踪滚动、不自动贴底 */
  enabled?: boolean;
  /** 距底部多少 px 内视为「在底部」 */
  bottomThreshold?: number;
  /** 内容变化时，若仍贴底则滚到底 */
  contentDeps?: unknown[];
}

function isNearBottom(el: HTMLElement, threshold: number) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function useStickToBottom({
  enabled = true,
  bottomThreshold = 48,
  contentDeps = [],
}: Options = {}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const stickRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const prevEnabledRef = useRef(enabled);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "instant") => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      if (behavior === "instant" || behavior === "auto") {
        stickRef.current = true;
        setShowScrollToBottom(false);
      }
    },
    []
  );

  const handleScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      const el = e.currentTarget;
      containerRef.current = el;
      if (!enabled) {
        setShowScrollToBottom(false);
        return;
      }
      const atBottom = isNearBottom(el, bottomThreshold);
      stickRef.current = atBottom;
      setShowScrollToBottom(!atBottom);
    },
    [enabled, bottomThreshold]
  );

  const bindContainer = useCallback((el: HTMLElement | null) => {
    containerRef.current = el;
  }, []);

  useEffect(() => {
    if (enabled && !prevEnabledRef.current) {
      stickRef.current = true;
      requestAnimationFrame(() => scrollToBottom("instant"));
    }
    if (!enabled) {
      setShowScrollToBottom(false);
    }
    prevEnabledRef.current = enabled;
  }, [enabled, scrollToBottom]);

  useEffect(() => {
    if (!enabled || !stickRef.current) return;
    requestAnimationFrame(() => scrollToBottom("instant"));
    // contentDeps 由调用方传入，仅用于触发贴底
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scrollToBottom, ...contentDeps]);

  const jumpToBottom = useCallback(() => {
    stickRef.current = true;
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return {
    containerRef,
    bindContainer,
    handleScroll,
    scrollToBottom,
    jumpToBottom,
    showScrollToBottom: enabled && showScrollToBottom,
  };
}
