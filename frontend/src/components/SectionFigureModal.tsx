import { Input, Modal } from "antd";
import { useEffect, useState } from "react";

const FIGURE_HINTS = [
  "信息图：3–5 个要点分区，每区配简洁图标",
  "架构图：自上而下分层，箭头表示数据流",
  "流程图：左→右步骤，菱形表判断",
  "对比图：左右并列，高亮差异模块",
  "机制图：中心机制 + 四周输入输出标注",
  "板书风格：黑板背景展示公式推导",
];

interface Props {
  open: boolean;
  heading: string;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (instruction: string) => void;
}

export default function SectionFigureModal({
  open,
  heading,
  loading,
  onCancel,
  onSubmit,
}: Props) {
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    if (open) setInstruction("");
  }, [open, heading]);

  return (
    <Modal
      title={`添加配图 · ${heading}`}
      open={open}
      okText={loading ? "生成中…" : "开始生成"}
      cancelText="取消"
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => onSubmit(instruction.trim())}
      destroyOnClose
    >
      <p className="section-action-modal-desc">
        将根据本节内容自动推断图类型（信息图/架构/流程等）与比例，并按火山 Seedream 模板生成提示词；也可选填补充要求。
      </p>
      <Input.TextArea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="选填：如「画成三栏对比图」「突出 CSA 三块结构」…"
        autoSize={{ minRows: 3, maxRows: 6 }}
        disabled={loading}
      />
      <div className="section-action-hints">
        {FIGURE_HINTS.map((hint) => (
          <button
            key={hint}
            type="button"
            className="section-action-hint-chip"
            disabled={loading}
            onClick={() => setInstruction(hint)}
          >
            {hint}
          </button>
        ))}
      </div>
    </Modal>
  );
}
