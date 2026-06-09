import type { NotePipelineState, StreamEvent } from "../types/events";

const TOKEN_KEY = "yanxi_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "请求失败");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestText(
  path: string,
  options: RequestInit = {}
): Promise<string> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "请求失败");
  }
  return res.text();
}

export interface AuthResult {
  access_token: string;
  user_id: number;
  username: string;
  display_name?: string;
  account_code?: string;
  avatar_url?: string | null;
}

export interface UserProfile {
  id: number;
  username: string;
  display_name: string;
  account_code: string;
  avatar_url: string | null;
  created_at: string;
}

export interface FolderNode {
  id: number;
  name: string;
  parent_id: number | null;
  paper_count: number;
  children: FolderNode[];
  created_at: string;
}

export interface PaperSummary {
  id: number;
  title: string;
  author: string;
  status: string;
  total_pages: number;
  parsed_pages: number;
  parse_elapsed_seconds: number;
  error_message: string;
  created_at: string;
  folder_ids: number[];
  folder_names: string[];
  has_note: boolean;
  thumbnail_url: string | null;
  summary: string;
  note_read_progress: number;
  note_last_scroll_top: number;
  note_last_read_at: string | null;
  note_read_epoch: number;
  cover_url: string | null;
  cover_status: string;
}

export interface PaperListParams {
  folderId?: number | null;
  uncategorized?: boolean;
  q?: string;
  sort?: "created_at_desc" | "title_asc";
}

export interface PaperDetail extends PaperSummary {
  pdf_url: string;
  markdown_url: string | null;
  has_markdown: boolean;
  has_markdown_translation: boolean;
  note_url: string | null;
  has_note: boolean;
  note_version: number;
  note_model: string;
  note_model_label: string;
}

export interface ModelOption {
  id: string;
  label: string;
  source: "builtin" | "custom";
}

export interface ModelListResponse {
  models: ModelOption[];
  default_model: string;
  /** 千帆 MCP 联网搜索已配置时，自定义模型可开启联网 */
  mcp_search_available: boolean;
  image_models: ImageModelOption[];
}

export interface ImageModelOption {
  id: string;
  label: string;
  hint: string;
  available: boolean;
}

export interface UserCustomModel {
  id: number;
  name: string;
  api_url: string;
  created_at: string;
}

export interface ChatConfig {
  models: ModelOption[];
  default_model: string;
  context_limit: number;
  /** 千帆 MCP 联网搜索是否已配置（自定义模型可用） */
  mcp_search_available: boolean;
  image_models: ImageModelOption[];
}

export interface ChatSuggestion {
  key: string;
  label: string;
}

export interface ChatAttachment {
  path: string;
  name?: string;
  url?: string;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  reasoning_content?: string;
  had_tool_call?: boolean;
  references?: unknown[];
  tool_trace?: unknown[];
  attachments?: ChatAttachment[];
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  created_at?: string;
}

export interface ChatConversation {
  id: number;
  paper_id: number;
  title: string;
  messages: ChatMessage[];
}

export interface ChatConversationSummary {
  id: number;
  paper_id: number;
  title: string;
  message_count: number;
  preview: string;
  created_at: string;
  updated_at: string;
}

export interface NoteVersionSummary {
  version: number;
  model: string;
  created_at: string | null;
  is_current: boolean;
}

export interface ChatSendPayload {
  content: string;
  conversation_id?: number;
  model: string;
  enable_thinking: boolean;
  enable_search: boolean;
  enable_figure_gen?: boolean;
  image_model?: string;
  attachments: { path: string; name: string }[];
}

export interface NoteRefinePayload {
  conversation_id: number;
  scope: "turn" | "conversation";
  intent?: "refine" | "expand" | "compare" | "summarize";
  assistant_message_id?: number;
  model?: string;
}

export interface NoteSectionRefinePayload {
  heading: string;
  instruction: string;
  model?: string;
  enable_thinking?: boolean;
  enable_search?: boolean;
  attachments?: { path: string; name: string }[];
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResult>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<AuthResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getMe: () => request<UserProfile>("/api/users/me"),

  updateProfile: (display_name: string) =>
    request<UserProfile>("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name }),
    }),

  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/users/me/avatar", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "上传失败");
    }
    return res.json() as Promise<UserProfile>;
  },

  changePassword: (old_password: string, new_password: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ old_password, new_password }),
    }),

  listPapers: (params?: PaperListParams) => {
    const search = new URLSearchParams();
    if (params?.folderId != null) search.set("folder_id", String(params.folderId));
    if (params?.uncategorized) search.set("uncategorized", "true");
    if (params?.q?.trim()) search.set("q", params.q.trim());
    if (params?.sort) search.set("sort", params.sort);
    const qs = search.toString();
    return request<PaperSummary[]>(`/api/papers${qs ? `?${qs}` : ""}`);
  },

  updatePaper: (
    id: number,
    body: { title?: string; author?: string; folder_ids?: number[] }
  ) =>
    request<PaperSummary>(`/api/papers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listFolders: () => request<FolderNode[]>("/api/folders"),

  createFolder: (body: { name: string; parent_id?: number | null }) =>
    request<FolderNode>("/api/folders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFolder: (
    id: number,
    body: { name?: string; parent_id?: number | null }
  ) =>
    request<FolderNode>(`/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteFolder: (id: number) =>
    request<void>(`/api/folders/${id}`, { method: "DELETE" }),

  getPaper: (id: number) => request<PaperDetail>(`/api/papers/${id}`),

  updateNoteReadProgress: (
    id: number,
    body: {
      progress: number;
      scroll_top: number;
      note_read_epoch: number;
    }
  ) =>
    request<PaperSummary>(`/api/papers/${id}/note-read-progress`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  triggerPaperEnrichment: (id: number, force = false) =>
    request<PaperSummary>(
      `/api/papers/${id}/enrichment${force ? "?force=true" : ""}`,
      { method: "POST" }
    ),

  uploadPaper: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch("/api/papers/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "上传失败");
    }
    return res.json() as Promise<PaperSummary>;
  },

  fetchMarkdown: async (id: number) => {
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/markdown`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Markdown 未就绪");
    return res.text();
  },

  fetchMarkdownTranslation: async (id: number) => {
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/markdown/translation`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("加载中文翻译失败");
    return res.text();
  },

  subscribeMarkdownTranslateStream: (
    id: number,
    model: string,
    onEvent: StreamHandler,
    onDone?: () => void
  ) => {
    const token = getToken();
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/papers/${id}/markdown/translate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ model }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          onEvent({ type: "status", status: "failed", error: "翻译请求失败" });
          onDone?.();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          onDone?.();
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const data = JSON.parse(line.slice(5).trim()) as StreamEvent;
              onEvent(data);
              if (data.type === "done") finish();
            } catch {
              /* ignore */
            }
          }
        }
        finish();
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          onEvent({ type: "status", status: "failed", error: "连接中断" });
        }
        onDone?.();
      }
    })();

    return () => controller.abort();
  },

  fetchNote: async (id: number) => {
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/note`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("解读笔记未就绪");
    return res.text();
  },

  fetchNoteGenerationTrace: async (id: number): Promise<NotePipelineState | null> => {
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/note/generation-trace`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "请求失败");
    }
    return res.json() as Promise<NotePipelineState>;
  },

  updateNote: (id: number, content: string) =>
    request<{ ok: boolean; note_version: number }>(`/api/papers/${id}/note`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  regenerateNote: (id: number, model?: string, imageModel?: string) =>
    request<{ status: string }>(`/api/papers/${id}/note/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        model: model || "",
        image_model: imageModel || "ark",
      }),
    }),

  listModels: () => request<ModelListResponse>("/api/models"),

  listCustomModels: () => request<UserCustomModel[]>("/api/models/custom"),

  createCustomModel: (payload: { name: string; api_url: string; api_key: string }) =>
    request<UserCustomModel>("/api/models/custom", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteCustomModel: (id: number) =>
    request<void>(`/api/models/custom/${id}`, { method: "DELETE" }),

  deletePaper: (id: number) =>
    request<void>(`/api/papers/${id}`, { method: "DELETE" }),

  downloadNoteZip: (id: number) => downloadFile(`/api/papers/${id}/note/export/zip`),

  downloadNotePdf: (id: number) => downloadFile(`/api/papers/${id}/note/export/pdf`),

  getChatConfig: (id: number) =>
    request<ChatConfig>(`/api/papers/${id}/chat/config`),

  getChatSuggestions: (id: number) =>
    request<{ items: ChatSuggestion[] }>(`/api/papers/${id}/chat/suggestions`),

  getChatConversation: (id: number, conversationId?: number) =>
    request<ChatConversation>(
      conversationId != null
        ? `/api/papers/${id}/chat/conversation?conversation_id=${conversationId}`
        : `/api/papers/${id}/chat/conversation`
    ),

  listChatConversations: (id: number) =>
    request<{ items: ChatConversationSummary[]; active_id: number | null }>(
      `/api/papers/${id}/chat/conversations`
    ),

  createChatConversation: (id: number) =>
    request<ChatConversation>(`/api/papers/${id}/chat/conversations`, {
      method: "POST",
    }),

  resetChatConversation: (id: number) =>
    request<void>(`/api/papers/${id}/chat/conversation/reset`, { method: "POST" }),

  applyRefinedNote: (
    id: number,
    content: string,
    options?: {
      model?: string;
      conversation_id?: number;
      assistant_message_id?: number;
    }
  ) =>
    request<{ ok: boolean; note_version: number; previous_version: number }>(
      `/api/papers/${id}/note/refine/apply`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          model: options?.model || "",
          conversation_id: options?.conversation_id,
          assistant_message_id: options?.assistant_message_id,
        }),
      }
    ),

  listNoteVersions: (id: number) =>
    request<{ items: NoteVersionSummary[]; current_version: number }>(
      `/api/papers/${id}/note/versions`
    ),

  getNoteVersion: (id: number, version: number) =>
    requestText(`/api/papers/${id}/note/versions/${version}`),

  restoreNoteVersion: (id: number, version: number) =>
    request<{ ok: boolean; note_version: number; previous_version: number }>(
      `/api/papers/${id}/note/versions/restore`,
      {
        method: "POST",
        body: JSON.stringify({ version }),
      }
    ),

  addSectionFigure: (
    id: number,
    heading: string,
    instruction?: string,
    imageModel?: string
  ) =>
    request<{ ok: boolean; note_version: number; image_path: string; heading: string; image_model?: string; content?: string }>(
      `/api/papers/${id}/note/sections/add-figure`,
      {
        method: "POST",
        body: JSON.stringify({
          heading,
          instruction: instruction || "",
          image_model: imageModel || "ark",
        }),
      }
    ),

  deleteNoteFigure: (id: number, imagePath: string) =>
    request<{
      ok: boolean;
      note_version: number;
      image_path: string;
      file_deleted: boolean;
      remaining_refs: number;
      removed_lines?: number;
      content?: string;
    }>(`/api/papers/${id}/note/figures/delete`, {
      method: "POST",
      body: JSON.stringify({ image_path: imagePath }),
    }),

  uploadChatImage: async (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/chat/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "上传失败");
    }
    return res.json() as Promise<{ path: string; name: string; url: string }>;
  },
};

async function downloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "下载失败");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  return { blob, filename: match?.[1] || "download" };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function buildAuthenticatedUrl(url: string): string {
  if (!url.startsWith("/api/")) return url;
  return withToken(url);
}

export function buildPaperFileUrl(
  paperId: number,
  relPath: string,
  cacheBust?: number | string
): string {
  const clean = relPath.replace(/^\.?\/?/, "");
  let url = withToken(`/api/papers/${paperId}/files/${clean}`);
  if (cacheBust != null && cacheBust !== "") {
    url += `&v=${encodeURIComponent(String(cacheBust))}`;
  }
  return url;
}

export function buildPaperPdfUrl(paperId: number): string {
  return withToken(`/api/papers/${paperId}/pdf`);
}

export function buildPaperCoverUrl(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  return buildAuthenticatedUrl(coverUrl);
}

export type StreamHandler = (event: StreamEvent) => void;

export function subscribePaperEvents(
  paperId: number,
  onEvent: StreamHandler,
  onDone?: () => void
): () => void {
  const token = getToken();
  const url = `/api/papers/${paperId}/events`;
  const controller = new AbortController();

  (async () => {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          onEvent(data);
          if (data.type === "done") onDone?.();
        } catch {
          /* ignore */
        }
      }
    }
  })();

  return () => controller.abort();
}

export function subscribeChatStream(
  paperId: number,
  payload: ChatSendPayload,
  onEvent: StreamHandler,
  onDone?: () => void
): () => void {
  const token = getToken();
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`/api/papers/${paperId}/chat/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onEvent({ type: "status", status: "failed", error: "请求失败" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as StreamEvent;
            onEvent(data);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        onEvent({ type: "status", status: "failed", error: "连接中断" });
      }
    } finally {
      onDone?.();
    }
  })();

  return () => controller.abort();
}

export function subscribeNoteRefineStream(
  paperId: number,
  payload: NoteRefinePayload,
  onEvent: StreamHandler,
  onDone?: () => void
): () => void {
  const token = getToken();
  const controller = new AbortController();

  (async () => {
    const res = await fetch(`/api/papers/${paperId}/note/refine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      onEvent({ type: "status", status: "failed", error: "融合请求失败" });
      onDone?.();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim()) as StreamEvent;
          onEvent(data);
          if (data.type === "done") onDone?.();
        } catch {
          /* ignore */
        }
      }
    }
  })();

  return () => controller.abort();
}

export function subscribeSectionRefineStream(
  paperId: number,
  payload: NoteSectionRefinePayload,
  onEvent: StreamHandler,
  onDone?: () => void
): () => void {
  const token = getToken();
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`/api/papers/${paperId}/note/sections/refine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onEvent({ type: "status", status: "failed", error: "润色请求失败" });
        onDone?.();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as StreamEvent;
            onEvent(data);
            if (data.type === "done") onDone?.();
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        onEvent({ type: "status", status: "failed", error: "连接中断" });
      }
    } finally {
      onDone?.();
    }
  })();

  return () => controller.abort();
}
