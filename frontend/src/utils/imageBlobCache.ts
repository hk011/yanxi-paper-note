import { normalizeFigureRelPath } from "./genFigure";

type CacheEntry = {
  blobUrl: string | null;
  refCount: number;
  promise: Promise<string> | null;
};

const cache = new Map<string, CacheEntry>();
const revokeTimers = new Map<string, number>();

const REVOKE_DELAY_MS = 3000;

function figureCacheKey(paperId: number, relPath: string): string {
  return `${paperId}:${normalizeFigureRelPath(relPath)}`;
}

function cancelRevoke(key: string) {
  const timer = revokeTimers.get(key);
  if (timer != null) {
    window.clearTimeout(timer);
    revokeTimers.delete(key);
  }
}

function scheduleRevoke(key: string) {
  cancelRevoke(key);
  revokeTimers.set(
    key,
    window.setTimeout(() => {
      revokeTimers.delete(key);
      const entry = cache.get(key);
      if (entry && entry.refCount <= 0) {
        if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
        cache.delete(key);
      }
    }, REVOKE_DELAY_MS)
  );
}

export function peekImageBlob(key: string): string | null {
  cancelRevoke(key);
  return cache.get(key)?.blobUrl ?? null;
}

/** 强制丢弃某路径的 blob 缓存（配图重新生成或删除后调用） */
export function invalidateImageBlob(key: string): void {
  cancelRevoke(key);
  const entry = cache.get(key);
  if (entry?.blobUrl) {
    URL.revokeObjectURL(entry.blobUrl);
  }
  cache.delete(key);
}

export function invalidatePaperFigureBlob(paperId: number, relPath: string): void {
  invalidateImageBlob(figureCacheKey(paperId, relPath));
}

export function acquireImageBlob(
  key: string,
  fetchBlob: () => Promise<Blob>
): { promise: Promise<string>; release: () => void } {
  cancelRevoke(key);

  let entry = cache.get(key);
  if (!entry) {
    entry = { blobUrl: null, refCount: 0, promise: null };
    cache.set(key, entry);
  }

  entry.refCount++;

  const release = () => {
    const current = cache.get(key);
    if (!current) return;
    current.refCount--;
    if (current.refCount <= 0) {
      scheduleRevoke(key);
    }
  };

  if (entry.blobUrl) {
    return { promise: Promise.resolve(entry.blobUrl), release };
  }

  if (!entry.promise) {
    entry.promise = fetchBlob()
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const current = cache.get(key);
        if (current && current.refCount > 0) {
          current.blobUrl = url;
          return url;
        }
        URL.revokeObjectURL(url);
        throw new Error("aborted");
      })
      .catch((err) => {
        cache.delete(key);
        throw err;
      })
      .finally(() => {
        const current = cache.get(key);
        if (current) current.promise = null;
      });
  }

  return { promise: entry.promise, release };
}
