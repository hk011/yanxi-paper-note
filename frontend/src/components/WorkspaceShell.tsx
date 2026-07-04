import { Avatar, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  CaretRightOutlined,
  DoubleLeftOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { api, type FolderNode } from "../api/client";
import { buildAuthenticatedUrl } from "../api/client";
import { useAuthStore } from "../store/auth";
import { UNCATEGORIZED_THEME } from "../utils/folderColor";
import AccountModal from "./AccountModal";
import BrandMark from "./BrandMark";
import CreateFolderModal from "./CreateFolderModal";
import FolderTree from "./FolderTree";
import UploadPaperModal from "./UploadPaperModal";
import YanxiLogo from "./YanxiLogo";

interface WorkspaceShellProps {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  currentPaperId?: number | null;
  onNewPaper?: () => void;
  uploadModalOpen?: boolean;
  onUploadModalOpenChange?: (open: boolean) => void;
  onUploadSuccess?: () => void;
  sidebarRefreshKey?: number;
  children: ReactNode;
}

export default function WorkspaceShell({
  title,
  subtitle,
  headerActions,
  currentPaperId = null,
  onNewPaper,
  uploadModalOpen,
  onUploadModalOpenChange,
  onUploadSuccess,
  sidebarRefreshKey = 0,
  children,
}: WorkspaceShellProps) {
  const [pinned, setPinned] = useState(true);
  const [internalUploadOpen, setInternalUploadOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [totalPaperCount, setTotalPaperCount] = useState(0);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [categorizedExpanded, setCategorizedExpanded] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const folderMatch = useMatch("/library/folders/:folderId");
  const selectedFolderId = folderMatch ? Number(folderMatch.params.folderId) : null;
  const uncategorizedActive = searchParams.get("uncategorized") === "1";

  const logout = useAuthStore((s) => s.logout);
  const profile = useAuthStore((s) => s.profile);
  const avatarVersion = useAuthStore((s) => s.avatarVersion);
  const displayName = profile?.display_name || profile?.username || "我的账户";
  const avatarSrc =
    profile?.avatar_url != null
      ? `${buildAuthenticatedUrl(profile.avatar_url)}&v=${avatarVersion}`
      : undefined;

  const uploadOpen = uploadModalOpen ?? internalUploadOpen;
  const setUploadOpen = onUploadModalOpenChange ?? setInternalUploadOpen;

  const openUploadModal = useCallback(() => {
    setUploadOpen(true);
  }, [setUploadOpen]);

  const onLibraryPage =
    location.pathname === "/" ||
    location.pathname === "/library" ||
    Boolean(folderMatch);
  const onModelsPage = location.pathname === "/models";

  const loadSidebar = useCallback(async () => {
    try {
      const [tree, papers] = await Promise.all([api.listFolders(), api.listPapers()]);
      setFolders(tree);
      setTotalPaperCount(papers.length);
      setUncategorizedCount(
        papers.filter((paper) => !paper.folder_ids || paper.folder_ids.length === 0).length
      );
    } catch {
      /* 侧栏加载失败不阻塞主区域 */
    }
  }, []);

  useEffect(() => {
    void loadSidebar();
  }, [loadSidebar, sidebarRefreshKey, currentPaperId]);

  const handleFolderSelect = (folderId: number | null) => {
    if (folderId == null) {
      navigate({ pathname: "/", search: "" });
      return;
    }
    navigate(`/library/folders/${folderId}`);
  };

  const handleUncategorizedSelect = () => {
    if (uncategorizedActive) {
      navigate({ pathname: "/", search: "" });
      return;
    }
    navigate({ pathname: "/", search: "uncategorized=1" });
  };

  const openPeek = useCallback(() => {
    if (!pinned) setPeekOpen(true);
  }, [pinned]);

  const closePeek = useCallback(() => {
    if (!pinned) setPeekOpen(false);
  }, [pinned]);

  const pinSidebar = useCallback(() => {
    setPinned(true);
    setPeekOpen(false);
  }, []);

  const unpinSidebar = useCallback(() => {
    setPinned(false);
    setPeekOpen(false);
  }, []);

  const accountMenu: MenuProps["items"] = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "账户设置",
      onClick: () => setAccountOpen(true),
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "偏好设置",
      disabled: true,
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      danger: true,
      onClick: () => {
        logout();
        navigate("/login");
      },
    },
  ];

  const sidebarBody = (showCollapseBtn: boolean) => (
    <>
      <div className="workspace-sidebar-top">
        <BrandMark showText logoSize={34} className="workspace-brand" />
        {showCollapseBtn ? (
          <button
            type="button"
            className="workspace-collapse-btn"
            onClick={unpinSidebar}
            aria-label="收起侧栏"
            title="收起侧栏"
          >
            <DoubleLeftOutlined />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="workspace-new-btn"
        onClick={() => {
          openUploadModal();
          onNewPaper?.();
        }}
        title="新笔记"
      >
        <PlusOutlined />
        <span>新笔记</span>
      </button>

      <nav className="workspace-nav">
        <button
          type="button"
          className={`workspace-nav-item${onLibraryPage ? " is-active" : ""}`}
          onClick={() => navigate("/")}
        >
          <FolderOpenOutlined />
          <span>文献库</span>
        </button>
        <button
          type="button"
          className={`workspace-nav-item${onModelsPage ? " is-active" : ""}`}
          onClick={() => navigate("/models")}
        >
          <ThunderboltOutlined />
          <span>模型管理</span>
        </button>
      </nav>

      <div className="workspace-folder-wrap">
        <button
          type="button"
          className={`workspace-all-papers${
            selectedFolderId == null && onLibraryPage && !uncategorizedActive
              ? " is-active"
              : ""
          }`}
          onClick={() => handleFolderSelect(null)}
        >
          <span>全部文献</span>
          <span className="folder-tree-count">{totalPaperCount}</span>
        </button>
        <button
          type="button"
          className={`workspace-uncategorized${
            uncategorizedActive && onLibraryPage ? " is-active" : ""
          }`}
          onClick={handleUncategorizedSelect}
        >
          <span
            className="folder-color-dot"
            style={{ backgroundColor: UNCATEGORIZED_THEME.dot }}
            aria-hidden
          />
          <span>未归类</span>
          <span className="folder-tree-count">{uncategorizedCount}</span>
        </button>

        <div className="workspace-categorized-section">
          <div className="workspace-categorized-head">
            <button
              type="button"
              className="workspace-categorized-toggle"
              onClick={() => setCategorizedExpanded((v) => !v)}
              aria-expanded={categorizedExpanded}
            >
              <CaretRightOutlined
                className={`workspace-categorized-caret${
                  categorizedExpanded ? " is-expanded" : ""
                }`}
              />
              <span>已归类</span>
            </button>
            <button
              type="button"
              className="workspace-folder-add"
              onClick={() => setCreateFolderOpen(true)}
              title="新建文件夹"
            >
              <PlusOutlined />
            </button>
          </div>
          {categorizedExpanded ? (
            <FolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelect={handleFolderSelect}
              onChanged={loadSidebar}
            />
          ) : null}
        </div>
      </div>

      <div className="workspace-sidebar-bottom">
        <div className="workspace-assistant-preview">
          <RobotOutlined />
          <div>
            <strong>AI 助手</strong>
            <span>论文页右侧可用</span>
          </div>
        </div>

        <Dropdown menu={{ items: accountMenu }} trigger={["click"]} placement="topLeft">
          <button type="button" className="workspace-account-btn">
            <Avatar size={28} src={avatarSrc} icon={<UserOutlined />} />
            <span className="workspace-account-name">{displayName}</span>
          </button>
        </Dropdown>
        <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} />
        <CreateFolderModal
          open={createFolderOpen}
          onClose={() => setCreateFolderOpen(false)}
          onCreated={loadSidebar}
        />
      </div>
    </>
  );

  return (
    <div className={`workspace-shell${pinned ? " is-pinned" : " is-collapsed"}`}>
      <div className="workspace-side-col">
        {pinned ? (
          <aside className="workspace-sidebar is-pinned">{sidebarBody(true)}</aside>
        ) : (
          <div
            className={`workspace-side-hover${peekOpen ? " is-peeking" : ""}`}
            onMouseEnter={openPeek}
            onMouseLeave={closePeek}
          >
            <div className="workspace-sidebar-rail">
              <div className="workspace-rail-head">
                <button
                  type="button"
                  className="workspace-rail-toggle"
                  onClick={pinSidebar}
                  aria-label="固定展开侧栏"
                  title="点击固定侧栏"
                >
                  <MenuOutlined />
                </button>
                <button
                  type="button"
                  className="workspace-rail-brand"
                  onClick={pinSidebar}
                  aria-label="展开侧栏"
                  title="研析"
                >
                  <YanxiLogo size={40} variant="sm" className="workspace-rail-logo" />
                </button>
              </div>
            </div>

            <aside className={`workspace-sidebar is-peek${peekOpen ? " is-visible" : ""}`}>
              {sidebarBody(true)}
            </aside>
          </div>
        )}
      </div>

      <main className="workspace-main">
        <header className="workspace-main-header">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headerActions && <div className="workspace-header-actions">{headerActions}</div>}
        </header>
        <section className="workspace-content">{children}</section>
      </main>
      <UploadPaperModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folderId={uncategorizedActive ? null : selectedFolderId}
        onSuccess={() => {
          void loadSidebar();
          onUploadSuccess?.();
        }}
      />
    </div>
  );
}
