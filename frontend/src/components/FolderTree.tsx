import { useState } from "react";
import { CaretRightOutlined, MoreOutlined } from "@ant-design/icons";
import FolderColorDot from "./FolderColorDot";
import { Dropdown, Input, Modal, message } from "antd";
import type { FolderNode } from "../api/client";
import { api } from "../api/client";

interface FolderTreeProps {
  folders: FolderNode[];
  selectedFolderId: number | null;
  onSelect: (folderId: number | null) => void;
  onChanged: () => void;
}

function FolderItem({
  folder,
  folders,
  selectedFolderId,
  onSelect,
  onChanged,
  depth,
}: {
  folder: FolderNode;
  folders: FolderNode[];
  selectedFolderId: number | null;
  onSelect: (folderId: number | null) => void;
  onChanged: () => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [createValue, setCreateValue] = useState("");
  const hasChildren = folder.children.length > 0;
  const showChildren = expanded && (hasChildren || creating);

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name) {
      message.warning("文件夹名称不能为空");
      return;
    }
    try {
      await api.updateFolder(folder.id, { name });
      message.success("已重命名");
      setRenaming(false);
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "重命名失败");
    }
  };

  const handleCreateChild = async () => {
    const name = createValue.trim();
    if (!name) {
      message.warning("请输入文件夹名称");
      return;
    }
    try {
      await api.createFolder({ name, parent_id: folder.id });
      message.success("子文件夹已创建");
      setCreateValue("");
      setCreating(false);
      setExpanded(true);
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);
    Modal.confirm({
      title: "删除文件夹",
      content: "删除后文件夹内的论文不会被删除，仅解除归属关系。子文件夹也会一并删除。",
      okText: "删除",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        try {
          await api.deleteFolder(folder.id);
          message.success("文件夹已删除");
          if (selectedFolderId === folder.id) onSelect(null);
          onChanged();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
        }
      },
    });
  };

  const actionMenu = (
    <div className="folder-action-menu">
      <div className="folder-action-menu-head">{folder.name}</div>
      <button
        type="button"
        className="folder-action-menu-item"
        onClick={() => {
          setMenuOpen(false);
          setCreating(true);
          setExpanded(true);
          setCreateValue("");
        }}
      >
        创建新文件夹
      </button>
      <button
        type="button"
        className="folder-action-menu-item"
        onClick={() => {
          setMenuOpen(false);
          setRenaming(true);
          setRenameValue(folder.name);
        }}
      >
        重命名
      </button>
      <button
        type="button"
        className="folder-action-menu-item is-danger"
        onClick={handleDelete}
      >
        删除
      </button>
    </div>
  );

  return (
    <div className="folder-tree-branch">
      <div
        className={`folder-tree-item${selectedFolderId === folder.id ? " is-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasChildren || creating ? (
          <button
            type="button"
            className={`folder-tree-caret${expanded ? " is-expanded" : ""}`}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "收起" : "展开"}
          >
            <CaretRightOutlined />
          </button>
        ) : (
          <span className="folder-tree-caret-spacer" />
        )}
        <button
          type="button"
          className="folder-tree-label"
          onClick={() => onSelect(folder.id)}
        >
          <FolderColorDot folderId={folder.id} folders={folders} />
          <span className="folder-tree-name">{folder.name}</span>
          <span className="folder-tree-count">{folder.paper_count}</span>
        </button>
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          menu={{ items: [] }}
          dropdownRender={() => actionMenu}
          trigger={["click"]}
          placement="bottomRight"
        >
          <button type="button" className="folder-tree-more" onClick={(e) => e.stopPropagation()}>
            <MoreOutlined />
          </button>
        </Dropdown>
      </div>
      {renaming ? (
        <div className="folder-tree-inline-form" style={{ paddingLeft: 24 + depth * 14 }}>
          <Input
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onPressEnter={handleRename}
            autoFocus
          />
          <button type="button" className="folder-tree-inline-save" onClick={handleRename}>
            保存
          </button>
          <button
            type="button"
            className="folder-tree-inline-cancel"
            onClick={() => {
              setRenaming(false);
              setRenameValue(folder.name);
            }}
          >
            取消
          </button>
        </div>
      ) : null}
      {showChildren ? (
        <div className="folder-tree-children">
          {creating ? (
            <div
              className="folder-tree-inline-form folder-tree-inline-create"
              style={{ paddingLeft: 24 + (depth + 1) * 14 }}
            >
              <Input
                size="small"
                value={createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                onPressEnter={handleCreateChild}
                placeholder="新文件夹名称"
                autoFocus
              />
              <button type="button" className="folder-tree-inline-save" onClick={handleCreateChild}>
                创建
              </button>
              <button
                type="button"
                className="folder-tree-inline-cancel"
                onClick={() => {
                  setCreating(false);
                  setCreateValue("");
                }}
              >
                取消
              </button>
            </div>
          ) : null}
          {hasChildren
            ? folder.children.map((child) => (
                <FolderItem
                  key={child.id}
                  folder={child}
                  folders={folders}
                  selectedFolderId={selectedFolderId}
                  onSelect={onSelect}
                  onChanged={onChanged}
                  depth={depth + 1}
                />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export default function FolderTree({
  folders,
  selectedFolderId,
  onSelect,
  onChanged,
}: FolderTreeProps) {
  if (folders.length === 0) {
    return <div className="folder-tree-empty">暂无文件夹，点击 + 创建</div>;
  }
  return (
    <div className="folder-tree">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          onChanged={onChanged}
          depth={0}
        />
      ))}
    </div>
  );
}
