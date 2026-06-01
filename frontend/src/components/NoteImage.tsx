import { memo, useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { buildAuthenticatedUrl, buildPaperFileUrl, getToken } from "../api/client";
import { normalizeFigureRelPath } from "../utils/genFigure";
import { acquireImageBlob, peekImageBlob } from "../utils/imageBlobCache";

function resolveImageUrl(
  raw: string,
  paperId: number,
  cacheBust?: number | string
): string {
  if (!raw) return raw;
  if (raw.startsWith("/api/")) return buildAuthenticatedUrl(raw);
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (/^\/(assets|images)\//i.test(raw)) {
    return buildPaperFileUrl(paperId, raw.replace(/^\/+/, ""), cacheBust);
  }
  if (raw.startsWith("/")) return buildAuthenticatedUrl(raw);
  return buildPaperFileUrl(paperId, raw, cacheBust);
}

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  rawSrc: string;
  paperId: number;
  eager?: boolean;
  /** 流式期间直接用鉴权 URL，避免 blob 反复 revoke/重建导致闪动 */
  useDirectSrc?: boolean;
  /** 笔记版本等，用于配图 URL 缓存破除 */
  cacheBust?: number | string;
  onPreview?: (src: string) => void;
  onLoadError?: () => void;
}

/** 将鉴权图片预加载为 blob URL，便于本地打印与离线渲染 */
function NoteImage({
  rawSrc,
  paperId,
  eager = false,
  useDirectSrc = false,
  cacheBust,
  onPreview,
  onLoadError,
  className,
  alt,
  ...rest
}: Props) {
  const resolved = resolveImageUrl(rawSrc, paperId, cacheBust);
  const cacheKey = useMemo(
    () => `${paperId}:${normalizeFigureRelPath(rawSrc)}`,
    [paperId, rawSrc]
  );
  const [src, setSrc] = useState(() => {
    if (useDirectSrc) return resolved;
    return peekImageBlob(cacheKey) ?? resolved;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (useDirectSrc) {
      setSrc(resolved);
      return;
    }

    if (!resolved || resolved.startsWith("blob:") || resolved.startsWith("data:")) {
      setSrc(resolved);
      return;
    }

    const cached = peekImageBlob(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }

    const { promise, release } = acquireImageBlob(cacheKey, async () => {
      const token = getToken();
      const res = await fetch(resolved, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      return res.blob();
    });

    promise
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onLoadError?.();
        }
      });

    return () => {
      cancelled = true;
      release();
    };
  }, [cacheKey, resolved, onLoadError, useDirectSrc, cacheBust]);

  if (failed) {
    return null;
  }

  return (
    <img
      {...rest}
      alt={alt ?? ""}
      src={src}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
      onClick={() => onPreview?.(src)}
      onError={() => {
        setFailed(true);
        onLoadError?.();
      }}
    />
  );
}

export default memo(
  NoteImage,
  (prev, next) =>
    prev.rawSrc === next.rawSrc &&
    prev.paperId === next.paperId &&
    prev.eager === next.eager &&
    prev.useDirectSrc === next.useDirectSrc &&
    prev.cacheBust === next.cacheBust &&
    prev.className === next.className
);
