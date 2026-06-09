import { useMemo, useState } from "react";
import { Checkbox, Input, Popover, message } from "antd";
import type { FolderNode } from "../api/client";
import { api } from "../api/client";

interface MoveToFolderPopoverProps {
  open: boolean;
  folders: FolderNode[];
  currentFolderIds: number[];
  onClose: () => void;
  onSaved: () => void;
  paperId?: number;
  mode?: "merge" | "replace";
  dryRun?: boolean;
  onSelect?: (folderIds: number[]) => void;
  children: React.ReactElement;
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

export default function MoveToFolderPopover({
  open,
  folders,
  currentFolderIds,
  onClose,
  onSaved,
  paperId,
  mode = "merge",
  dryRun = false,
  onSelect,
  children,
}: MoveToFolderPopoverProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>(currentFolderIds);
  const [saving, setSaving] = useState(false);

  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((f) => f.name.toLowerCase().includes(q));
  }, [flat, query]);

  const exactMatch = flat.some((f) => f.name === query.trim());
  const showCreate = query.trim().length > 0 && !exactMatch;

  const handleCreate = async () => {
    const name = query.trim();
    if (!name) return;
    try {
      const created = await api.createFolder({ name });
      setSelected((prev) => [...new Set([...prev, created.id])]);
      setQuery("");
      onSaved();
      message.success(`已创建文件夹「${name}」`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleSave = async () => {
    const folderIds =
      mode === "merge"
        ? [...new Set([...currentFolderIds, ...selected])]
        : selected;
    if (dryRun) {
      onSelect?.(folderIds);
      onClose();
      return;
    }
    if (!paperId) return;
    setSaving(true);
    try {
      await api.updatePaper(paperId, { folder_ids: folderIds });
      message.success("已更新文件夹");
      onSaved();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div className="move-folder-popover" onClick={(e) => e.stopPropagation()}>
      <Input
        placeholder="搜索或创建文件夹"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        allowClear
      />
      {showCreate ? (
        <button type="button" className="move-folder-create" onClick={handleCreate}>
          创建「{query.trim()}」
        </button>
      ) : null}
      <div className="move-folder-list">
        {filtered.map((f) => (
          <label
            key={f.id}
            className="move-folder-item"
            style={{ paddingLeft: 8 + f.depth * 14 }}
          >
            <Checkbox
              checked={selected.includes(f.id)}
              onChange={(e) => {
                setSelected((prev) =>
                  e.target.checked
                    ? [...prev, f.id]
                    : prev.filter((id) => id !== f.id)
                );
              }}
            />
            <span>{f.name}</span>
          </label>
        ))}
      </div>
      <div className="move-folder-actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="is-primary" disabled={saving} onClick={handleSave}>
          确认
        </button>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      content={content}
      trigger="click"
      placement="bottomRight"
      onOpenChange={(v) => {
        if (!v) onClose();
        else setSelected(mode === "replace" ? currentFolderIds : currentFolderIds);
      }}
    >
      {children}
    </Popover>
  );
}
