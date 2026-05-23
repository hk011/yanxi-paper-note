import { Typography } from "antd";
import {
  buildAuthenticatedUrl,
  buildPaperFileUrl,
} from "../api/client";
import type { TimelineItem } from "../types/events";

const { Text, Paragraph } = Typography;

function normalizeHit(hit: unknown) {
  if (!hit || typeof hit !== "object") return null;
  const row = hit as Record<string, unknown>;
  const url =
    (row.url as string) ||
    (row.link as string) ||
    (row.source_url as string);
  if (typeof url !== "string" || !url.startsWith("http")) return null;
  return {
    url,
    title:
      (row.title as string) ||
      (row.name as string) ||
      url,
    snippet: (row.snippet as string) || (row.description as string) || "",
  };
}

function parseFigureOutput(output: unknown, paperId: number) {
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
  const message = data.message as string | undefined;
  const prompt = data.prompt as string | undefined;
  return { src, message, prompt };
}

function SearchHitsList({ hits }: { hits: unknown[] }) {
  const rows = hits.map(normalizeHit).filter(Boolean) as Array<{
    url: string;
    title: string;
    snippet: string;
  }>;
  if (rows.length === 0) {
    return <Text type="secondary">暂无检索结果</Text>;
  }
  return (
    <div className="tool-link-list thought-step-hits">
      {rows.map((ref, i) => (
        <a
          key={`${ref.url}-${i}`}
          className="tool-link-card"
          href={ref.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="tool-link-index">{i + 1}</span>
          <span>
            <span className="tool-link-title">{ref.title}</span>
            {ref.snippet ? (
              <span className="tool-link-snippet">{ref.snippet}</span>
            ) : null}
          </span>
        </a>
      ))}
    </div>
  );
}

interface Props {
  item: TimelineItem;
  paperId: number;
}

export default function ThoughtChainStepContent({ item, paperId }: Props) {
  if (item.kind === "thinking") {
    const text = (item.content || "").trim();
    if (!text) return null;
    return (
      <Paragraph className="thought-step-thinking-body">{text}</Paragraph>
    );
  }

  if (item.tool === "web_search") {
    const hits = item.hits || [];
    if (hits.length > 0) {
      return <SearchHitsList hits={hits} />;
    }
    const q =
      (item.input?.query as string) ||
      (item.content?.startsWith("搜索：") ? item.content.slice(3) : "");
    if (q) {
      return (
        <Text type="secondary" className="thought-step-query">
          查询：{q}
        </Text>
      );
    }
  }

  if (item.tool === "gen_figure") {
    const figure = parseFigureOutput(item.output, paperId);
    if (figure?.src) {
      return (
        <div className="thought-step-figure">
          <img src={figure.src} alt="生成配图" className="thought-step-figure-img" />
          {figure.prompt ? (
            <Text type="secondary" className="thought-step-figure-prompt">
              {figure.prompt}
            </Text>
          ) : null}
          {figure.message ? (
            <Text type="secondary" className="thought-step-figure-msg">
              {figure.message}
            </Text>
          ) : null}
        </div>
      );
    }
  }

  const raw =
    typeof item.output === "string"
      ? item.output
      : item.output
        ? JSON.stringify(item.output, null, 2)
        : (item.content || "").trim();

  if (raw) {
    return <pre className="thought-step-output-pre">{raw}</pre>;
  }

  return null;
}
