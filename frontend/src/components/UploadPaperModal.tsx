import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, Upload, message } from "antd";
import {
  CloudUploadOutlined,
  FileAddOutlined,
  FilePdfOutlined,
} from "@ant-design/icons";
import { api } from "../api/client";

const { Dragger } = Upload;

interface UploadPaperModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  folderId?: number | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPaperModal({
  open,
  onClose,
  onSuccess,
  folderId = null,
}: UploadPaperModalProps) {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedFile(null);
    setUploading(false);
  }, [open]);

  const handleClose = () => {
    if (uploading) return;
    onClose();
  };

  const handleSelectFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      message.error("仅支持 PDF 文件");
      return false;
    }
    setSelectedFile(file);
    return false;
  };

  const handleConfirm = async () => {
    if (!selectedFile) {
      message.warning("请先选择 PDF 文件");
      return;
    }
    setUploading(true);
    try {
      const paper = await api.uploadPaper(selectedFile, folderId);
      message.success("上传成功，开始解析…");
      onSuccess?.();
      onClose();
      navigate(`/papers/${paper.id}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      className="upload-paper-modal"
      open={open}
      onCancel={handleClose}
      footer={null}
      closable
      centered
      width={640}
      destroyOnHidden
      title={null}
    >
      <h2 className="upload-paper-modal-title">添加文献至你的阅读列表</h2>
      <div className="library-upload-panel">
        <div className="library-upload-panel-head">
          <CloudUploadOutlined />
          <span>上传本地文件</span>
        </div>
        {selectedFile ? (
          <div className="upload-paper-file-preview">
            <FilePdfOutlined className="upload-paper-file-icon" />
            <div className="upload-paper-file-meta">
              <span className="upload-paper-file-name">{selectedFile.name}</span>
              <span className="upload-paper-file-size">{formatFileSize(selectedFile.size)}</span>
            </div>
            <button
              type="button"
              className="upload-paper-file-repick"
              disabled={uploading}
              onClick={() => setSelectedFile(null)}
            >
              重新选择
            </button>
          </div>
        ) : (
          <Dragger
            className="library-upload-dragger"
            accept=".pdf,application/pdf"
            multiple={false}
            showUploadList={false}
            disabled={uploading}
            beforeUpload={handleSelectFile}
          >
            <p className="library-upload-dragger-icon">
              <FileAddOutlined />
            </p>
            <p className="library-upload-dragger-text">
              将您的文件拖放到这里或
              <span className="library-upload-dragger-link">点击上传</span>
            </p>
            <p className="library-upload-dragger-hint">仅支持 PDF 文件，单次上传 1 个文件</p>
          </Dragger>
        )}
      </div>
      <div className="upload-paper-modal-actions">
        <Button onClick={handleClose} disabled={uploading}>
          取消
        </Button>
        <Button type="primary" loading={uploading} disabled={!selectedFile} onClick={handleConfirm}>
          确认并开始解析
        </Button>
      </div>
    </Modal>
  );
}
