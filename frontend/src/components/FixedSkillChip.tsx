import { CloseOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: string;
  onClose?: () => void;
  closeLabel?: string;
}

/** 输入框内固定技能引用标签（类似「图像生成」技能条） */
export default function FixedSkillChip({
  icon,
  label,
  onClose,
  closeLabel = "退出",
}: Props) {
  return (
    <span className="fixed-skill-chip">
      <span className="fixed-skill-chip-icon">{icon}</span>
      <span className="fixed-skill-chip-label">{label}</span>
      {onClose ? (
        <button
          type="button"
          className="fixed-skill-chip-close"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <CloseOutlined />
        </button>
      ) : null}
    </span>
  );
}
