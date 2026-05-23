import {
  buildAuthenticatedUrl,
  buildPaperFileUrl,
} from "../api/client";
import type { TimelineItem } from "../types/events";

export interface GenFigurePreview {
  src: string;
  prompt?: string;
  message?: string;
}

export function parseFigureOutput(
  output: unknown,
  paperId: number
): GenFigurePreview | null {
  let data: Record<string, unknown> | null = null;
  if (typeof output === "string") {
    try {
      data = JSON.parse(output) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (output && typeof output === "object") {
    data = output as Record<string, unknown>;
  }
  if (!data) return null;

  const apiUrl = data.api_url as string | undefined;
  const imageUrl = data.image_url as string | undefined;
  const src = apiUrl
    ? buildAuthenticatedUrl(apiUrl)
    : imageUrl
      ? buildPaperFileUrl(paperId, imageUrl)
      : undefined;
  if (!src) return null;

  return {
    src,
    message: data.message as string | undefined,
    prompt: data.prompt as string | undefined,
  };
}

export function collectGenFigurePreviews(
  items: TimelineItem[] | undefined,
  paperId: number
): GenFigurePreview[] {
  if (!items?.length) return [];
  const out: GenFigurePreview[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || item.tool !== "gen_figure") continue;
    const figure = parseFigureOutput(item.output, paperId);
    if (figure?.src) out.push(figure);
  }
  return out;
}
