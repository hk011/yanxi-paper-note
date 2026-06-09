import { useEffect, useState } from "react";
import { Input, Modal, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { FolderNode, PaperSummary } from "../api/client";
import { api } from "../api/client";
import MoveToFolderPopover from "./MoveToFolderPopover";

interface EditPaperModalProps {
  open: boolean;
  paper: PaperSummary | null;
  folders: FolderNode[];
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditPaperModal({
  open,
  paper,
  folders,
  readOnly = false,
  onClose,
  onSaved,
}: EditPaperModalProps) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [folderIds, setFolderIds] = useState<number[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !paper) return;
    setTitle(paper.title);
    setAuthor(paper.author || "");
    setFolderIds(paper.folder_ids || []);
  }, [open, paper]);

  const folderNameMap = new Map<number, string>();
  const walk = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      folderNameMap.set(n.id, n.name);
      walk(n.children);
    }
  };
  walk(folders);

  const handleSave = async () => {
    if (!paper) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      message.warning("标题不能为空");
      return;
    }
    setLoading(true);
    try {
      await api.updatePaper(paper.id, {
        title: trimmedTitle,
        author: author.trim(),
        folder_ids: folderIds,
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const removeFolder = (id: number) => {
    setFolderIds((prev) => prev.filter((fid) => fid !== id));
  };

  return (
    <Modal
      title={readOnly ? "文献信息" : "编辑文献"}
      open={open}
      onCancel={onClose}
      onOk={readOnly ? onClose : handleSave}
      confirmLoading={loading}
      okText={readOnly ? "关闭" : "保存"}
      cancelText="取消"
      cancelButtonProps={{ style: readOnly ? { display: "none" } : undefined }}
      destroyOnHidden
    >
      <div className="edit-paper-form">
        <label>标题</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} readOnly={readOnly} />
        <label>作者</label>
        <Input value={author} onChange={(e) => setAuthor(e.target.value)} readOnly={readOnly} />
        <label>文件夹</label>
        <div className="edit-paper-folders">
          {folderIds.map((id) => (
            <Tag
              key={id}
              closable={!readOnly}
              onClose={() => removeFolder(id)}
            >
              {folderNameMap.get(id) || paper?.folder_names?.[folderIds.indexOf(id)] || "文件夹"}
            </Tag>
          ))}
          {!readOnly && paper ? (
            <MoveToFolderPopover
              open={folderPickerOpen}
              folders={folders}
              currentFolderIds={folderIds}
              mode="replace"
              dryRun
              onSelect={setFolderIds}
              onClose={() => setFolderPickerOpen(false)}
              onSaved={() => setFolderPickerOpen(false)}
            >
              <button
                type="button"
                className="edit-paper-add-folder"
                onClick={() => setFolderPickerOpen(true)}
              >
                <PlusOutlined />
              </button>
            </MoveToFolderPopover>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
