import katexCssUrl from "katex/dist/katex.min.css?url";
import { PRINT_DOCUMENT_CSS } from "./printNoteStyles";

function waitForImage(img: HTMLImageElement, timeoutMs = 8000): Promise<void> {
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveAssetUrl(url: string): string {
  return url.startsWith("http") ? url : new URL(url, window.location.href).href;
}

function eagerLoadImages(container: HTMLElement): void {
  container.querySelectorAll("img").forEach((img) => {
    img.loading = "eager";
    if (!img.complete && img.src) {
      const src = img.src;
      img.src = "";
      img.src = src;
    }
  });
}

function buildPrintDocument(title: string, bodyHtml: string, katexHref: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(katexHref)}">
<style>${PRINT_DOCUMENT_CSS}</style>
</head>
<body>
<div class="note-print-root">
${bodyHtml}
</div>
</body>
</html>`;
}

/**
 * 从页面上已排版好的 KaTeX 同步宽度与内联 style 到克隆节点。
 * 打印 iframe 里块级元素默认 100% 宽，会导致 .frac-line{width:100%} 横贯整页。
 */
function syncKatexLayoutFromLive(source: HTMLElement, clone: HTMLElement): void {
  const sourceNodes = source.querySelectorAll(".katex");
  const cloneNodes = clone.querySelectorAll(".katex");

  sourceNodes.forEach((orig, index) => {
    const cloned = cloneNodes[index];
    if (!(orig instanceof HTMLElement) || !(cloned instanceof HTMLElement)) return;

    const origMath = resolveKatexMathRoot(orig);
    const clonedMath = resolveKatexMathRoot(cloned);
    if (!origMath || !clonedMath) return;

    const rect = origMath.getBoundingClientRect();
    if (rect.width > 0) {
      const widthPx = `${Math.ceil(rect.width)}px`;
      applyKatexWidth(cloned, clonedMath, widthPx);
    }

    const origHtml = origMath.querySelector(".katex-html");
    const clonedHtml = clonedMath.querySelector(".katex-html");
    if (origHtml && clonedHtml) {
      syncStyledDescendants(origHtml, clonedHtml);
    }
  });

  source.querySelectorAll(".katex-display").forEach((origDisplay, index) => {
    const clonedDisplay = clone.querySelectorAll(".katex-display")[index];
    if (!(origDisplay instanceof HTMLElement) || !(clonedDisplay instanceof HTMLElement)) {
      return;
    }
    clonedDisplay.style.display = "block";
    clonedDisplay.style.textAlign = "center";
    clonedDisplay.style.width = "auto";
    clonedDisplay.style.maxWidth = "100%";
  });
}

function resolveKatexMathRoot(el: HTMLElement): HTMLElement | null {
  if (el.classList.contains("katex-html")) return el.parentElement;
  const inner = el.querySelector(":scope > .katex");
  return inner instanceof HTMLElement ? inner : el;
}

function applyKatexWidth(host: HTMLElement, mathRoot: HTMLElement, widthPx: string): void {
  host.style.display = "inline-block";
  host.style.width = widthPx;
  host.style.maxWidth = "100%";

  mathRoot.style.display = "inline-block";
  mathRoot.style.width = widthPx;
  mathRoot.style.maxWidth = "100%";

  const html = mathRoot.querySelector(".katex-html");
  if (html instanceof HTMLElement) {
    html.style.display = "inline-block";
    html.style.width = widthPx;
    html.style.maxWidth = "100%";
  }
}

function syncStyledDescendants(origRoot: Element, cloneRoot: Element): void {
  const origStyled = origRoot.querySelectorAll<HTMLElement>("[style]");
  const cloneStyled = cloneRoot.querySelectorAll<HTMLElement>("[style]");
  cloneStyled.forEach((el, i) => {
    const src = origStyled[i];
    const style = src?.getAttribute("style");
    if (style) el.setAttribute("style", style);
  });
}

function waitForStylesheet(doc: Document, href: string, timeoutMs = 5000): Promise<void> {
  const link = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).find(
    (node) => (node as HTMLLinkElement).href === href
  ) as HTMLLinkElement | undefined;
  if (!link) return Promise.resolve();
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  });
}

function waitIframeImages(doc: Document, timeoutMs = 3000): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(imgs.map((img) => waitForImage(img))).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

async function waitIframeReady(
  doc: Document,
  win: Window,
  katexHref: string,
  timeoutMs = 5000
): Promise<void> {
  await waitForStylesheet(doc, katexHref, timeoutMs);
  await waitIframeImages(doc, timeoutMs);
  const fonts = win.document.fonts;
  if (!fonts?.ready) return;
  await Promise.race([
    fonts.ready,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/** 等待打印区域内图片加载完成 */
export async function preparePrintImages(
  container: HTMLElement | null
): Promise<{ total: number; loaded: number }> {
  if (!container) {
    throw new Error("暂无可打印的笔记内容");
  }
  eagerLoadImages(container);
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(imgs.map((img) => waitForImage(img)));
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  const loaded = imgs.filter((img) => img.naturalWidth > 0).length;
  return { total: imgs.length, loaded };
}

/**
 * 在隐藏 iframe 中仅渲染笔记 HTML 并打印，避免主页面
 * overflow:hidden / 100vh 布局把正文裁成一页。
 */
export function printNoteArea(container: HTMLElement | null): void {
  if (!container) {
    throw new Error("暂无可打印的笔记内容");
  }
  if (container.classList.contains("note-print-area--hidden")) {
    throw new Error("当前处于编辑模式，无法打印");
  }

  eagerLoadImages(container);

  const clone = prepareCloneForPrint(container);
  syncKatexLayoutFromLive(container, clone);

  const title =
    clone.querySelector(".note-print-title")?.textContent?.trim() || "论文解读笔记";
  const katexHref = resolveAssetUrl(katexCssUrl);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";

  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    throw new Error("无法创建打印窗口");
  }

  doc.open();
  doc.write(buildPrintDocument(title, clone.innerHTML, katexHref));
  doc.close();

  const cleanup = () => {
    iframe.remove();
  };

  const triggerPrint = () => {
    win.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 5000);
    win.focus();
    win.print();
  };

  void waitIframeReady(doc, win, katexHref).then(() => {
    triggerPrint();
  });
}

function prepareCloneForPrint(container: HTMLElement): HTMLElement {
  const clone = container.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      ".note-draft-waiting, .note-empty-state, .stream-cursor, .ant-modal-root"
    )
    .forEach((el) => el.remove());

  const origImgs = container.querySelectorAll("img");
  const cloneImgs = clone.querySelectorAll("img");
  cloneImgs.forEach((img, index) => {
    const orig = origImgs[index];
    if (orig?.src) {
      img.src = orig.src;
    }
  });

  const titleEl = clone.querySelector(".note-print-title");
  if (titleEl instanceof HTMLElement) {
    titleEl.style.display = "block";
  }

  return clone;
}
