import { useEffect, useRef, useState } from "react";

/** 流式期间按 intervalMs 批量刷新展示内容，对齐 X-Markdown 官方 benchmark（50ms/chunk） */
export function useStreamDisplayContent(
  source: string,
  streaming: boolean,
  intervalMs = 50
): string {
  const [display, setDisplay] = useState(source);
  const latestRef = useRef(source);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = source;

    if (!streaming) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDisplay(source);
      return;
    }

    if (timerRef.current != null) return;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setDisplay(latestRef.current);
    }, intervalMs);
  }, [source, streaming, intervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  return streaming ? display : source;
}
