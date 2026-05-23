import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { DownOutlined, ThunderboltOutlined } from "@ant-design/icons";

interface Props {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

function modelLabel(id: string, short = false): string {
  if (id.includes("pro")) return short ? "Pro" : "Seed 2.0 Pro";
  if (id.includes("lite")) return short ? "Lite" : "Seed 2.0 Lite";
  if (id.includes("mini")) return short ? "Mini" : "Seed 2.0 Mini";
  return id;
}

export default function ModelSwitcher({
  models,
  value,
  onChange,
  disabled,
}: Props) {
  const items: MenuProps["items"] = models.map((m) => ({
    key: m,
    label: modelLabel(m),
    onClick: () => onChange(m),
  }));

  return (
    <Dropdown
      menu={{ items, selectable: true, selectedKeys: [value] }}
      trigger={["click"]}
      disabled={disabled}
    >
      <button type="button" className="chat-agent-pill">
        <ThunderboltOutlined className="chat-agent-pill-icon" />
        <span>{modelLabel(value, true)}</span>
        <DownOutlined className="chat-agent-pill-chevron" />
      </button>
    </Dropdown>
  );
}
