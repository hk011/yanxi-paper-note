import { EditFilled } from "@ant-design/icons";

interface Props {
  className?: string;
}

/** 工具栏「AI 编辑」图标：实心笔 + 环绕闪光 */
export default function AiEditIcon({ className = "" }: Props) {
  return (
    <span className={`ai-edit-icon${className ? ` ${className}` : ""}`} aria-hidden>
      <span className="ai-edit-icon-pen-wrap">
        <EditFilled className="ai-edit-icon-pen" />
      </span>
      <span className="ai-edit-icon-spark ai-edit-icon-spark--tl">✦</span>
      <span className="ai-edit-icon-spark ai-edit-icon-spark--tr">✨</span>
      <span className="ai-edit-icon-spark ai-edit-icon-spark--br">✦</span>
    </span>
  );
}
