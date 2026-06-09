import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckOutlined } from "@ant-design/icons";
import { Input, Modal, Spin, message } from "antd";
import FolderColorDot from "./FolderColorDot";
import type { FolderNode } from "../api/client";
import { api } from "../api/client";

interface MoveToFolderModalProps {
  open: boolean;
  currentFolderIds: number[];
  paperId: number;
  onClose: () => void;
  onSaved: () => void;
}

interface FlatFolder {
  id: number;
  name: string;
  depth: number;
}

function flattenFolders(nodes: FolderNode[], depth = 0): FlatFolder[] {
  const out: FlatFolder[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth });
    out.push(...flattenFolders(node.children, depth + 1));
  }
  return out;
}

export default function MoveToFolderModal({
  open,
  currentFolderIds,
  paperId,
  onClose,
  onSaved,
}: MoveToFolderModalProps) {
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [movingId, setMovingId] = useState<number | null>(null);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      setFolders(await api.listFolders());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载文件夹失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void loadFolders();
  }, [open, loadFolders]);

  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((f) => f.name.toLowerCase().includes(q));
  }, [flat, query]);

  const handlePickFolder = async (folderId: number, folderName: string) => {
    const alreadyIn = currentFolderIds.includes(folderId);
    const folderIds = alreadyIn
      ? currentFolderIds.filter((id) => id !== folderId)
      : [...new Set([...currentFolderIds, folderId])];

    setMovingId(folderId);
    try {
      await api.updatePaper(paperId, { folder_ids: folderIds });
      message.success(alreadyIn ? `已从「${folderName}」移出` : `已移至「${folderName}」`);
      onSaved();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "移动失败");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <Modal
      title="移动至文件夹"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={360}
    >
      <div className="move-folder-popover">
        <Input
          placeholder="搜索文件夹"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
        />
        <Spin spinning={loading}>
          <div className="move-folder-list move-folder-pick-list">
            {filtered.length === 0 ? (
              <div className="move-folder-empty">
                {loading ? "加载中…" : "暂无文件夹，请先在侧栏创建"}
              </div>
            ) : (
              filtered.map((f) => {
                const selected = currentFolderIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`move-folder-pick-item${selected ? " is-selected" : ""}`}
                    style={{ paddingLeft: 12 + f.depth * 16 }}
                    disabled={movingId === f.id}
                    onClick={() => void handlePickFolder(f.id, f.name)}
                  >
                    <FolderColorDot folderId={f.id} folders={folders} />
                    <span className="move-folder-pick-name">{f.name}</span>
                    {selected ? <CheckOutlined className="move-folder-pick-check" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </Spin>
      </div>
    </Modal>
  );
}
