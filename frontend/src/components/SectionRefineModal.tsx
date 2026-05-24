import { Input, Modal, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ModelOption, subscribeSectionRefineStream } from "../api/client";
import ChatFeatureToggles from "./ChatFeatureToggles";
import ModelSwitcher, { isCustomModel } from "./ModelSwitcher";

const REFINE_HINTS = [
  "写得更通俗易懂，适合非专业读者",
  "补充 1–2 个具体例子帮助理解",
  "保留要点，压缩篇幅，去掉重复表述",
  "与上一小节衔接，补一句过渡",
];

interface Props {
  open: boolean;
  paperId: number;
  heading: string;
  onCancel: () => void;
  onReviewReady: (mergedContent: string, model: string) => void;
}

export default function SectionRefineModal({
  open,
  paperId,
  heading,
  onCancel,
  onReviewReady,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [enableThinking, setEnableThinking] = useState(true);
  const [enableSearch, setEnableSearch] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<(() => void) | null>(null);
  const previewRef = useRef("");

  const customModel = isCustomModel(models, model);

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setPreview("");
    setError("");
    setLoading(false);
    previewRef.current = "";
    void api.getChatConfig(paperId).then((cfg) => {
      setModels(cfg.models);
      setModel(cfg.default_model);
    });
    return () => abortRef.current?.();
  }, [open, paperId, heading]);

  useEffect(() => {
    if (customModel && enableSearch) setEnableSearch(false);
  }, [customModel, enableSearch]);

  const handleSubmit = useCallback(() => {
    const inst = instruction.trim();
    if (!inst || !model || loading) return;
    setLoading(true);
    setPreview("");
    setError("");
    previewRef.current = "";
    abortRef.current?.();
    abortRef.current = subscribeSectionRefineStream(
      paperId,
      {
        heading,
        instruction: inst,
        model,
        enable_thinking: enableThinking,
        enable_search: enableSearch,
      },
      (ev) => {
        if (ev.type === "content" && ev.delta) {
          previewRef.current += ev.delta;
          setPreview(previewRef.current);
        }
        if (ev.type === "status") {
          if (ev.status === "failed") {
            setError(ev.error || "润色失败");
            setLoading(false);
          }
          if (ev.status === "refined") {
            setLoading(false);
            const merged =
              typeof ev.merged_content === "string" ? ev.merged_content : "";
            const modelKey = typeof ev.model === "string" ? ev.model : "";
            if (merged.trim()) {
              onReviewReady(merged, modelKey);
            } else {
              setError("润色结果为空");
            }
          }
        }
      },
      () => setLoading(false)
    );
  }, [
    instruction,
    model,
    loading,
    paperId,
    heading,
    enableThinking,
    enableSearch,
    onReviewReady,
  ]);

  const handleClose = () => {
    if (loading) abortRef.current?.();
    onCancel();
  };

  return (
    <Modal
      title={`润色本节 · ${heading}`}
      open={open}
      width={640}
      okText={loading ? "润色中…" : "开始润色"}
      cancelText="取消"
      confirmLoading={loading}
      onCancel={handleClose}
      onOk={handleSubmit}
      destroyOnClose
    >
      <p className="section-action-modal-desc">
        只改写当前小节正文，保留本节已有配图引用；完成后可预览 diff 再决定是否保存。
      </p>
      <Input.TextArea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="描述要如何改这一节…"
        autoSize={{ minRows: 3, maxRows: 6 }}
        disabled={loading}
      />
      <div className="section-action-hints">
        {REFINE_HINTS.map((hint) => (
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
      <div className="section-refine-modal-controls">
        {models.length > 0 ? (
          <ModelSwitcher
            models={models}
            value={model}
            onChange={setModel}
            disabled={loading}
          />
        ) : null}
        <ChatFeatureToggles
          compact
          enableThinking={enableThinking}
          enableSearch={enableSearch}
          onThinkingChange={setEnableThinking}
          onSearchChange={setEnableSearch}
          disabled={loading}
          searchDisabled={customModel}
          searchDisabledReason="自定义模型不支持联网搜索"
        />
      </div>
      {loading || preview ? (
        <div className="section-refine-preview">
          <div className="section-refine-preview-label">
            {loading ? "生成预览" : "本节预览"}
            {loading ? <Spin size="small" /> : null}
          </div>
          <pre className="section-refine-preview-body">{preview || "…"}</pre>
        </div>
      ) : null}
      {error ? <p className="section-action-error">{error}</p> : null}
    </Modal>
  );
}
