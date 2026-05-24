import { BulbOutlined, GlobalOutlined, PictureOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

interface Props {
  enableThinking: boolean;
  enableSearch: boolean;
  enableFigureGen?: boolean;
  onThinkingChange: (value: boolean) => void;
  onSearchChange: (value: boolean) => void;
  onFigureGenChange?: (value: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
  searchDisabled?: boolean;
  searchDisabledReason?: string;
  showFigureGen?: boolean;
}

export default function ChatFeatureToggles({
  enableThinking,
  enableSearch,
  enableFigureGen = false,
  onThinkingChange,
  onSearchChange,
  onFigureGenChange,
  disabled,
  compact = false,
  searchDisabled = false,
  searchDisabledReason = "当前模型不支持联网搜索",
  showFigureGen = false,
}: Props) {
  const searchTooltip = searchDisabled
    ? searchDisabledReason
    : enableSearch
      ? compact
        ? "联网搜索：开"
        : "联网搜索已开启"
      : compact
        ? "联网搜索：关"
        : "联网搜索已关闭";

  const figureTooltip = enableFigureGen
    ? compact
      ? "AI 配图：开（可融入笔记）"
      : "AI 配图已开启，生成后可用「融入笔记」"
    : compact
      ? "AI 配图：关"
      : "AI 配图已关闭";

  if (compact) {
    return (
      <div className="chat-mode-pills">
        <Tooltip title={enableThinking ? "深度思考：开" : "深度思考：关"}>
          <button
            type="button"
            className={`chat-mode-pill${enableThinking ? " is-active" : ""}`}
            onClick={() => onThinkingChange(!enableThinking)}
            disabled={disabled}
            aria-pressed={enableThinking}
          >
            <BulbOutlined />
            <span>思考</span>
          </button>
        </Tooltip>
        <Tooltip title={searchTooltip}>
          <button
            type="button"
            className={`chat-mode-pill${enableSearch ? " is-active" : ""}${
              searchDisabled ? " is-disabled" : ""
            }`}
            onClick={() => {
              if (!searchDisabled) onSearchChange(!enableSearch);
            }}
            disabled={disabled || searchDisabled}
            aria-pressed={enableSearch}
          >
            <GlobalOutlined />
            <span>联网</span>
          </button>
        </Tooltip>
        {showFigureGen && onFigureGenChange ? (
          <Tooltip title={figureTooltip}>
            <button
              type="button"
              className={`chat-mode-pill${enableFigureGen ? " is-active" : ""}`}
              onClick={() => onFigureGenChange(!enableFigureGen)}
              disabled={disabled}
              aria-pressed={enableFigureGen}
            >
              <PictureOutlined />
              <span>配图</span>
            </button>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  return (
    <div className="chat-feature-toggles">
      <Tooltip title={enableThinking ? "深度思考已开启" : "深度思考已关闭"}>
        <button
          type="button"
          className={`chat-feature-chip${enableThinking ? " is-active" : ""}`}
          onClick={() => onThinkingChange(!enableThinking)}
          disabled={disabled}
          aria-pressed={enableThinking}
        >
          <BulbOutlined />
          <span>深度思考</span>
        </button>
      </Tooltip>
      <Tooltip title={searchTooltip}>
        <button
          type="button"
          className={`chat-feature-chip${enableSearch ? " is-active" : ""}${
            searchDisabled ? " is-disabled" : ""
          }`}
          onClick={() => {
            if (!searchDisabled) onSearchChange(!enableSearch);
          }}
          disabled={disabled || searchDisabled}
          aria-pressed={enableSearch}
        >
          <GlobalOutlined />
          <span>联网搜索</span>
        </button>
      </Tooltip>
      {showFigureGen && onFigureGenChange ? (
        <Tooltip title={figureTooltip}>
          <button
            type="button"
            className={`chat-feature-chip${enableFigureGen ? " is-active" : ""}`}
            onClick={() => onFigureGenChange(!enableFigureGen)}
            disabled={disabled}
            aria-pressed={enableFigureGen}
          >
            <PictureOutlined />
            <span>AI 配图</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
