import { Avatar, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  DoubleLeftOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { type ReactNode, useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildAuthenticatedUrl } from "../api/client";
import { useAuthStore } from "../store/auth";
import AccountModal from "./AccountModal";
import BrandMark from "./BrandMark";
import YanxiLogo from "./YanxiLogo";

export interface SidebarPaper {
  id: number;
  title: string;
  status: string;
}

interface WorkspaceShellProps {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  papers?: SidebarPaper[];
  currentPaperId?: number | null;
  children: ReactNode;
}

const STATUS_DOT: Record<string, string> = {
  uploading: "default",
  parsing: "processing",
  parsed: "success",
  noting: "processing",
  done: "success",
  failed: "error",
};

export default function WorkspaceShell({
  title,
  subtitle,
  headerActions,
  papers = [],
  currentPaperId = null,
  children,
}: WorkspaceShellProps) {
  const [pinned, setPinned] = useState(true);
  const [peekOpen, setPeekOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const profile = useAuthStore((s) => s.profile);
  const avatarVersion = useAuthStore((s) => s.avatarVersion);
  const displayName = profile?.display_name || profile?.username || "我的账户";
  const avatarSrc =
    profile?.avatar_url != null
      ? `${buildAuthenticatedUrl(profile.avatar_url)}&v=${avatarVersion}`
      : undefined;

  const onTasksPage = location.pathname === "/";
  const onModelsPage = location.pathname === "/models";

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
        onClick={() => navigate("/")}
        title="新笔记"
      >
        <PlusOutlined />
        <span>新笔记</span>
      </button>

      <nav className="workspace-nav">
        <button
          type="button"
          className={`workspace-nav-item${onTasksPage ? " is-active" : ""}`}
          onClick={() => navigate("/")}
        >
          <FolderOpenOutlined />
          <span>任务管理</span>
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

      <div className="workspace-task-list-wrap">
        <div className="workspace-section-label">任务列表</div>
        <div className="workspace-task-list">
          {papers.length === 0 ? (
            <div className="workspace-task-empty">暂无任务</div>
          ) : (
            papers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`workspace-task-item${
                  currentPaperId === p.id ? " is-active" : ""
                }`}
                onClick={() => navigate(`/papers/${p.id}`)}
              >
                <span
                  className={`workspace-task-dot is-${STATUS_DOT[p.status] ?? "default"}`}
                />
                <FileTextOutlined className="workspace-task-icon" />
                <span className="workspace-task-title">{p.title}</span>
              </button>
            ))
          )}
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
    </div>
  );
}
