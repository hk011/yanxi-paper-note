import { VerticalAlignBottomOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

interface Props {
  visible: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
}

export default function ScrollToBottomButton({
  visible,
  onClick,
  className = "stick-scroll-bottom-btn",
  title = "回到底部",
}: Props) {
  if (!visible) return null;
  return (
    <Tooltip title={title}>
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={title}
      >
        <VerticalAlignBottomOutlined />
      </button>
    </Tooltip>
  );
}
