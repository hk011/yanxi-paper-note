import { CloseOutlined, LoadingOutlined } from "@ant-design/icons";
import type { AttachmentsProps } from "@ant-design/x";

type AttachmentItem = NonNullable<AttachmentsProps["items"]>[number];

interface Props {
  items: AttachmentItem[];
  onRemove: (uid: string) => void;
}

export default function ChatImageAttachments({ items, onRemove }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="chat-composer-images" role="list" aria-label="已添加图片">
      {items.map((item) => {
        const src = item.thumbUrl || item.url;
        const uploading = item.status === "uploading";
        return (
          <div key={item.uid} className="chat-composer-image-chip" role="listitem">
            {src ? (
              <img src={src} alt={item.name || "图片"} />
            ) : (
              <span className="chat-composer-image-placeholder" />
            )}
            {uploading ? (
              <span className="chat-composer-image-loading">
                <LoadingOutlined spin />
              </span>
            ) : null}
            <button
              type="button"
              className="chat-composer-image-remove"
              onClick={() => onRemove(item.uid)}
              aria-label="移除图片"
            >
              <CloseOutlined />
            </button>
          </div>
        );
      })}
    </div>
  );
}
