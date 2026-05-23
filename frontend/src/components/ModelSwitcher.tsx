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

export default function ModelSwitcher({
  models,
  value,
  onChange,
  disabled,
  compact = false,
}: Props) {
  const selectedCustom = isCustomModel(models, value);

  const items: MenuProps["items"] = models.map((m) => ({
    key: m.id,
    label: (
      <span className="model-switcher-menu-item">
        <span>{m.label}</span>
        {m.source === "custom" ? (
          <span className="model-switcher-tags">
            <span className="model-switcher-custom-tag">自定义</span>
            <span className="model-switcher-no-search-tag">不支持联网搜索</span>
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
        <span className="model-switcher-pill-hint">无联网</span>
      ) : null}
      <DownOutlined className="chat-agent-pill-chevron" />
    </button>
  );

  return (
    <Dropdown
      menu={{ items, selectable: true, selectedKeys: value ? [value] : [] }}
      trigger={["click"]}
      disabled={disabled}
    >
      {selectedCustom ? (
        <Tooltip title="自定义模型不支持联网搜索">{button}</Tooltip>
      ) : (
        button
      )}
    </Dropdown>
  );
}

export { resolveLabel as modelLabel, isCustomModel };
