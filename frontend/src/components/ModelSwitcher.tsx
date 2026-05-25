import { Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { DownOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { ModelOption } from "../api/client";

interface Props {
  models: ModelOption[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean;
  /** 千帆 MCP 联网搜索是否已配置 */
  mcpSearchAvailable?: boolean;
}

function resolveLabel(models: ModelOption[], id: string, short = false): string {
  const found = models.find((m) => m.id === id);
  const label = found?.label || id;
  if (short && label.length > 18) {
    return `${label.slice(0, 16)}…`;
  }
  return label;
}

function isCustomModel(models: ModelOption[], id: string): boolean {
  return models.find((m) => m.id === id)?.source === "custom";
}

function customSupportsSearch(mcpSearchAvailable: boolean): boolean {
  return mcpSearchAvailable;
}

export default function ModelSwitcher({
  models,
  value,
  onChange,
  disabled,
  compact = false,
  mcpSearchAvailable = false,
}: Props) {
  const selectedCustom = isCustomModel(models, value);
  const selectedCustomSearch = selectedCustom && customSupportsSearch(mcpSearchAvailable);

  const items: MenuProps["items"] = models.map((m) => ({
    key: m.id,
    label: (
      <span className="model-switcher-menu-item">
        <span>{m.label}</span>
        {m.source === "custom" ? (
          <span className="model-switcher-tags">
            <span className="model-switcher-custom-tag">自定义</span>
            {customSupportsSearch(mcpSearchAvailable) ? (
              <span className="model-switcher-mcp-search-tag">可联网</span>
            ) : (
              <span className="model-switcher-no-search-tag">无联网</span>
            )}
          </span>
        ) : null}
      </span>
    ),
    onClick: () => onChange(m.id),
  }));

  const button = (
    <button
      type="button"
      className={`chat-agent-pill${compact ? " chat-agent-pill--compact" : ""}${
        selectedCustom ? " chat-agent-pill--custom" : ""
      }`}
    >
      <ThunderboltOutlined className="chat-agent-pill-icon" />
      <span>{resolveLabel(models, value, compact)}</span>
      {selectedCustom ? (
        <span className="model-switcher-pill-hint">
          {selectedCustomSearch ? "可联网" : "无联网"}
        </span>
      ) : null}
      <DownOutlined className="chat-agent-pill-chevron" />
    </button>
  );

  const tooltip = selectedCustom
    ? selectedCustomSearch
      ? "自定义模型：开启联网后将通过千帆 MCP 搜索"
      : "自定义模型：未配置 web_search_mcp_server_key，无法联网"
    : undefined;

  return (
    <Dropdown
      menu={{ items, selectable: true, selectedKeys: value ? [value] : [] }}
      trigger={["click"]}
      disabled={disabled}
    >
      {tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button}
    </Dropdown>
  );
}

export { resolveLabel as modelLabel, isCustomModel };
