import { useCallback, useEffect, useState } from "react";
import { useMatch, useSearchParams } from "react-router-dom";
import { Button, Empty, Input, Segmented, message } from "antd";
import {
  AppstoreOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { api, type FolderNode, type PaperSummary } from "../api/client";
import PaperCard from "../components/PaperCard";
import PaperListRow from "../components/PaperListRow";
import WorkspaceShell from "../components/WorkspaceShell";

type LibraryViewMode = "card" | "list";

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderMatch = useMatch("/library/folders/:folderId");
  const selectedFolderId = folderMatch ? Number(folderMatch.params.folderId) : null;
  const filterUncategorized = searchParams.get("uncategorized") === "1";

  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [elapsedMap, setElapsedMap] = useState<Record<number, number>>({});
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<LibraryViewMode>("card");
  const [uploadOpen, setUploadOpen] = useState(false);

  const hasParsing = papers.some(
    (p) => p.status === "parsing" || p.status === "uploading" || p.status === "noting"
  );

  const hasCoverPending = papers.some((p) => p.cover_status === "generating");

  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await api.listFolders());
    } catch {
      /* 侧栏文件夹加载失败不阻塞主区域 */
    }
  }, []);

  const loadPapers = useCallback(async () => {
    try {
      const list = await api.listPapers({
        folderId: filterUncategorized ? null : selectedFolderId,
        uncategorized: filterUncategorized || undefined,
        q: activeQuery || undefined,
        sort: "created_at_desc",
      });
      const visible = filterUncategorized
        ? list.filter((paper) => !paper.folder_ids || paper.folder_ids.length === 0)
        : list;
      setPapers(visible);
      setElapsedMap((prev) => {
        const next = { ...prev };
        for (const p of visible) {
          if (p.status === "parsing" || p.status === "uploading" || p.status === "noting") {
            next[p.id] = Math.max(prev[p.id] ?? 0, p.parse_elapsed_seconds);
          } else {
            delete next[p.id];
          }
        }
        return next;
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }, [selectedFolderId, activeQuery, filterUncategorized]);

  useEffect(() => {
    if (selectedFolderId && filterUncategorized) {
      const next = new URLSearchParams(searchParams);
      next.delete("uncategorized");
      setSearchParams(next, { replace: true });
    }
  }, [selectedFolderId, filterUncategorized, searchParams, setSearchParams]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders, sidebarRefreshKey]);

  useEffect(() => {
    void loadPapers();
  }, [loadPapers, sidebarRefreshKey]);

  useEffect(() => {
    if (!hasParsing) return;
    const timer = setInterval(() => {
      setElapsedMap((prev) => {
        const next = { ...prev };
        for (const p of papers) {
          if (p.status === "parsing" || p.status === "uploading" || p.status === "noting") {
            next[p.id] = (next[p.id] ?? p.parse_elapsed_seconds) + 1;
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasParsing, papers]);

  useEffect(() => {
    if (!hasParsing) return;
    const timer = setInterval(() => {
      void loadPapers();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasParsing, loadPapers]);

  useEffect(() => {
    if (!hasCoverPending) return;
    const timer = setInterval(() => {
      void loadPapers();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasCoverPending, loadPapers]);

  const handleChanged = useCallback(() => {
    void loadPapers();
    refreshSidebar();
  }, [loadPapers, refreshSidebar]);

  const handleSearch = () => {
    setActiveQuery(searchInput.trim());
  };

  const folderName = (() => {
    if (!selectedFolderId) return null;
    const walk = (nodes: FolderNode[]): string | null => {
      for (const n of nodes) {
        if (n.id === selectedFolderId) return n.name;
        const child = walk(n.children);
        if (child) return child;
      }
      return null;
    };
    return walk(folders);
  })();

  const headerTitle = filterUncategorized
    ? "未归类"
    : folderName || "文献库";
  const headerSubtitle = filterUncategorized
    ? `共 ${papers.length} 篇未归类文章`
    : `共 ${papers.length} 篇文章`;

  return (
    <WorkspaceShell
      title={headerTitle}
      subtitle={headerSubtitle}
      sidebarRefreshKey={sidebarRefreshKey}
      uploadModalOpen={uploadOpen}
      onUploadModalOpenChange={setUploadOpen}
      onUploadSuccess={handleChanged}
      headerActions={
        <Button
          className="library-outline-btn"
          icon={<PlusOutlined />}
          onClick={() => setUploadOpen(true)}
        >
          添加文章
        </Button>
      }
    >
      <div className="library-page">
        <div className="library-toolbar">
          <Input
            className="library-search"
            prefix={<SearchOutlined />}
            placeholder="试试输入标题、作者进行搜索…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            onClear={() => {
              setSearchInput("");
              setActiveQuery("");
            }}
          />
          <Button className="library-search-btn" type="primary" onClick={handleSearch}>
            搜索
          </Button>
          <Segmented
            className="library-view-toggle"
            value={viewMode}
            onChange={(v) => setViewMode(v as LibraryViewMode)}
            options={[
              { value: "card", icon: <AppstoreOutlined />, label: "卡片" },
              { value: "list", icon: <UnorderedListOutlined />, label: "列表" },
            ]}
          />
        </div>

        {papers.length === 0 ? (
          activeQuery || selectedFolderId || filterUncategorized ? (
            <Empty
              className="library-empty"
              description={
                activeQuery
                  ? "没有匹配的论文"
                  : filterUncategorized
                    ? "所有论文都已归类"
                    : "该文件夹暂无论文"
              }
            />
          ) : (
            <Empty className="library-empty" description="还没有文献">
              <Button
                className="library-outline-btn"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setUploadOpen(true)}
              >
                添加第一篇文章
              </Button>
            </Empty>
          )
        ) : viewMode === "card" ? (
          <div className="library-grid">
            {papers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                folders={folders}
                elapsedSeconds={elapsedMap[paper.id]}
                onChanged={handleChanged}
              />
            ))}
          </div>
        ) : (
          <div className="library-list-card">
            <table className="paper-list-table">
              <thead>
                <tr>
                  <th>文献</th>
                  <th>状态</th>
                  <th>阅读进度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((paper) => (
                  <PaperListRow
                    key={paper.id}
                    paper={paper}
                    folders={folders}
                    elapsedSeconds={elapsedMap[paper.id]}
                    onChanged={handleChanged}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
