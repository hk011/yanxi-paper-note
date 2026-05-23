import { BulbOutlined, GlobalOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

interface Props {
  enableThinking: boolean;
  enableSearch: boolean;
  onThinkingChange: (value: boolean) => void;
  onSearchChange: (value: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}

export default function ChatFeatureToggles({
  enableThinking,
  enableSearch,
  onThinkingChange,
  onSearchChange,
  disabled,
  compact = false,
}: Props) {
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
        <Tooltip title={enableSearch ? "联网搜索：开" : "联网搜索：关"}>
          <button
            type="button"
            className={`chat-mode-pill${enableSearch ? " is-active" : ""}`}
            onClick={() => onSearchChange(!enableSearch)}
            disabled={disabled}
            aria-pressed={enableSearch}
          >
            <GlobalOutlined />
            <span>联网</span>
          </button>
        </Tooltip>
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
      <Tooltip title={enableSearch ? "联网搜索已开启" : "联网搜索已关闭"}>
        <button
          type="button"
          className={`chat-feature-chip${enableSearch ? " is-active" : ""}`}
          onClick={() => onSearchChange(!enableSearch)}
          disabled={disabled}
          aria-pressed={enableSearch}
        >
          <GlobalOutlined />
          <span>联网搜索</span>
        </button>
      </Tooltip>
    </div>
  );
}
