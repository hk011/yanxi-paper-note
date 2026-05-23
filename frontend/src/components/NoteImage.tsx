import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { buildAuthenticatedUrl, buildPaperFileUrl, getToken } from "../api/client";

function resolveImageUrl(raw: string, paperId: number): string {
  if (!raw) return raw;
  if (raw.startsWith("/api/")) return buildAuthenticatedUrl(raw);
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return buildAuthenticatedUrl(raw);
  return buildPaperFileUrl(paperId, raw);
}

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  rawSrc: string;
  paperId: number;
  eager?: boolean;
  onPreview?: (src: string) => void;
}

/** 将鉴权图片预加载为 blob URL，便于本地打印与离线渲染 */
export default function NoteImage({
  rawSrc,
  paperId,
  eager = false,
  onPreview,
  className,
  alt,
  ...rest
}: Props) {
  const resolved = resolveImageUrl(rawSrc, paperId);
  const [src, setSrc] = useState(resolved);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    if (!resolved || resolved.startsWith("blob:") || resolved.startsWith("data:")) {
      setSrc(resolved);
      return;
    }

    (async () => {
      try {
        const token = getToken();
        const res = await fetch(resolved, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setSrc(resolved);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(resolved);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved]);

  return (
    <img
      {...rest}
      alt={alt ?? ""}
      src={src}
      loading={eager ? "eager" : "lazy"}
      className={className}
      onClick={() => onPreview?.(src)}
    />
  );
}
