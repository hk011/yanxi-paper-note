import { Alert, Input, Modal, Spin, Upload } from "antd";
import type { AttachmentsProps } from "@ant-design/x";
import { PictureOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  buildPaperFileUrl,
  ModelOption,
  subscribeSectionRefineStream,
} from "../api/client";
import ChatImageAttachments from "./ChatImageAttachments";
import ChatFeatureToggles from "./ChatFeatureToggles";
import ModelSwitcher, { isCustomModel } from "./ModelSwitcher";
import NoteImage from "./NoteImage";
import { extractSectionImageRefs } from "../utils/noteSection";
import { normalizeImageSrcKey } from "../utils/markdownImages";

const REFINE_HINTS = [
  "写得更通俗易懂，适合非专业读者",
  "补充 1–2 个具体例子帮助理解",
  "保留要点，压缩篇幅，去掉重复表述",
  "与上一小节衔接，补一句过渡",
];

type AttachmentItem = NonNullable<AttachmentsProps["items"]>[number];

interface Props {
  open: boolean;
  paperId: number;
  heading: string;
  noteContent: string;
  onCancel: () => void;
  onReviewReady: (mergedContent: string, model: string) => void;
}

export default function SectionRefineModal({
  open,
  paperId,
  heading,
  noteContent,
  onCancel,
  onReviewReady,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [enableThinking, setEnableThinking] = useState(true);
  const [enableSearch, setEnableSearch] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [mcpSearchAvailable, setMcpSearchAvailable] = useState(false);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [extraAttachments, setExtraAttachments] = useState<AttachmentItem[]>([]);
  const abortRef = useRef<(() => void) | null>(null);
  const previewRef = useRef("");

  const customModel = isCustomModel(models, model);
  const sectionImages = useMemo(
    () => (open ? extractSectionImageRefs(noteContent, heading) : []),
    [open, noteContent, heading]
  );

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setPreview("");
    setError("");
    setLoading(false);
    setExtraAttachments([]);
    previewRef.current = "";
    void api.getChatConfig(paperId).then((cfg) => {
      setModels(cfg.models);
      setModel(cfg.default_model);
      setMcpSearchAvailable(Boolean(cfg.mcp_search_available));
    });
    return () => abortRef.current?.();
  }, [open, paperId, heading]);

  const searchDisabled = customModel && !mcpSearchAvailable;

  useEffect(() => {
    if (searchDisabled && enableSearch) setEnableSearch(false);
  }, [searchDisabled, enableSearch]);

  const uploadAttachment = async (file: File) => {
    return api.uploadChatImage(paperId, file);
  };

  const handleAddFile = async (file: File) => {
    if (customModel) return;
    const uid = `refine-${Date.now()}-${file.name}`;
    const thumbUrl = URL.createObjectURL(file);
    setExtraAttachments((prev) => [
      ...prev,
      {
        uid,
        name: file.name,
        status: "uploading",
        thumbUrl,
        url: thumbUrl,
      },
    ]);
    try {
      const result = await uploadAttachment(file);
      setExtraAttachments((prev) =>
        prev.map((a) =>
          a.uid === uid
            ? {
                ...a,
                status: "done",
                response: result,
                url: result.url || buildPaperFileUrl(paperId, result.path),
              }
            : a
        )
      );
    } catch {
      setExtraAttachments((prev) => prev.filter((a) => a.uid !== uid));
      setError("图片上传失败");
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (customModel) return;
    const file = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/")
    );
    if (!file) return;
    e.preventDefault();
    void handleAddFile(file);
  };

  const pendingExtra = extraAttachments.filter((a) => a.status === "uploading");
  const doneExtra = extraAttachments
    .filter((a) => a.status === "done")
    .map((a) => ({
      path: (a.response as { path?: string } | undefined)?.path || "",
      name: a.name || "",
    }))
    .filter((a) => a.path);

  const handleSubmit = useCallback(() => {
    const inst = instruction.trim();
    if (!inst || !model || loading || pendingExtra.length > 0) return;
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
        attachments: customModel ? [] : doneExtra,
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
    customModel,
    doneExtra,
    pendingExtra.length,
    onReviewReady,
  ]);

  const handleClose = () => {
    if (loading) abortRef.current?.();
    onCancel();
  };

  const visionHint = customModel
    ? "自定义模型不支持识图：本节已有图片与你添加的图片均不会上传，仅依据文字润色。如需结合图片，请改用内置多模态模型。"
    : sectionImages.length > 0
      ? `将默认上传本节 ${sectionImages.length} 张引用图片${
          doneExtra.length > 0 ? `，以及你补充的 ${doneExtra.length} 张` : ""
        }，供模型结合图文润色。`
      : doneExtra.length > 0
        ? `将上传你补充的 ${doneExtra.length} 张图片供模型参考。`
        : "本节正文暂无图片引用；可点击下方添加参考图。";

  return (
    <Modal
      title={`润色本节 · ${heading}`}
      open={open}
      width={680}
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
      <Alert type="info" showIcon message={visionHint} className="section-refine-vision-alert" />
      {sectionImages.length > 0 ? (
        <div className="section-refine-section-images">
          <span className="section-refine-section-images-label">
            <PictureOutlined /> 本节图片（默认上传）
          </span>
          <div className="section-refine-section-images-row">
            {sectionImages.map((img) => {
              const key = normalizeImageSrcKey(img.src);
              return (
                <div key={key} className="section-refine-section-image-chip">
                  <NoteImage
                    rawSrc={img.src}
                    paperId={paperId}
                    eager
                    alt={img.alt || "本节图片"}
                    className="section-refine-section-image-thumb"
                  />
                  {img.alt ? (
                    <span className="section-refine-section-image-caption">{img.alt}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <Input.TextArea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onPaste={handlePaste}
        placeholder="描述要如何改这一节…（可粘贴图片）"
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
      {!customModel ? (
        <div className="section-refine-extra-images">
          <ChatImageAttachments
            items={extraAttachments}
            onRemove={(uid) =>
              setExtraAttachments((prev) => prev.filter((a) => a.uid !== uid))
            }
          />
          <Upload
            accept="image/jpeg,image/png,image/gif,image/webp"
            showUploadList={false}
            disabled={loading}
            beforeUpload={(file) => {
              void handleAddFile(file);
              return false;
            }}
          >
            <button
              type="button"
              className="section-refine-add-image-btn"
              disabled={loading}
            >
              <PlusOutlined /> 添加图片
            </button>
          </Upload>
        </div>
      ) : null}
      <div className="section-refine-modal-controls">
        {models.length > 0 ? (
          <ModelSwitcher
            models={models}
            value={model}
            onChange={setModel}
            disabled={loading}
            mcpSearchAvailable={mcpSearchAvailable}
          />
        ) : null}
        <ChatFeatureToggles
          compact
          enableThinking={enableThinking}
          enableSearch={enableSearch}
          onThinkingChange={setEnableThinking}
          onSearchChange={setEnableSearch}
          disabled={loading}
          searchDisabled={searchDisabled}
          searchDisabledReason={
            mcpSearchAvailable
              ? "当前模型不支持联网搜索"
              : "自定义模型需配置千帆 MCP 联网搜索（web_search_mcp_server_key）"
          }
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
