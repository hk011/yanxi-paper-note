import { Segmented, Tag, Tooltip } from "antd";
import type { ImageModelOption } from "../api/client";

export const IMAGE_MODEL_KEY = "yanxi:image-model";

export function pickDefaultImageModel(
  options: ImageModelOption[],
  saved?: string | null
): string {
  if (saved && options.some((o) => o.id === saved && o.available)) {
    return saved;
  }
  const firstAvailable = options.find((o) => o.available);
  return firstAvailable?.id || "ark";
}

/** API 未返回时的兜底列表（如后端未重启） */
export const DEFAULT_IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  { id: "ark", label: "豆包 Seedream", hint: "通用学术配图", available: true },
  { id: "sensenova", label: "商汤 Nova", hint: "更适合信息图", available: false },
];

export function resolveImageModelOptions(
  fromApi?: ImageModelOption[] | null
): ImageModelOption[] {
  if (fromApi && fromApi.length > 0) return fromApi;
  return DEFAULT_IMAGE_MODEL_OPTIONS;
}

interface Props {
  options: ImageModelOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

export default function ImageModelPicker({
  options,
  value,
  onChange,
  disabled,
  compact = false,
  label = "配图模型",
}: Props) {
  if (options.length === 0) return null;

  const segmentedOptions = options.map((opt) => {
    const hintTag =
      opt.id === "sensenova" && opt.available ? (
        <Tag color="blue" className="image-model-hint-tag">
          更适合信息图
        </Tag>
      ) : null;

    const labelNode = (
      <span className="image-model-option-label">
        <span>{opt.label}</span>
        {hintTag}
      </span>
    );

    return {
      value: opt.id,
      label: opt.available ? (
        labelNode
      ) : (
        <Tooltip title="未配置 API Key">{labelNode}</Tooltip>
      ),
      disabled: !opt.available,
    };
  });

  return (
    <div className={`image-model-picker${compact ? " image-model-picker--compact" : ""}`}>
      {!compact ? <span className="image-model-picker-label">{label}</span> : null}
      <Segmented
        size={compact ? "small" : "middle"}
        options={segmentedOptions}
        value={value}
        onChange={(next) => onChange(String(next))}
        disabled={disabled}
      />
    </div>
  );
}
