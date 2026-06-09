import { useEffect, useState } from "react";
import { Input, Modal, message } from "antd";
import { api } from "../api/client";

interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateFolderModal({
  open,
  onClose,
  onCreated,
}: CreateFolderModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
  }, [open]);

  const handleOk = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning("请输入文件夹名称");
      return;
    }
    setLoading(true);
    try {
      await api.createFolder({ name: trimmed, parent_id: null });
      message.success("文件夹已创建");
      onCreated();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="新建文件夹"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
    >
      <div className="create-folder-form">
        <label>名称</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入文件夹名称"
          onPressEnter={handleOk}
          autoFocus
        />
      </div>
    </Modal>
  );
}
