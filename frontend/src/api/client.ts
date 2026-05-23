import type { StreamEvent } from "../types/events";

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

export interface PaperSummary {
  id: number;
  title: string;
  status: string;
  total_pages: number;
  parsed_pages: number;
  parse_elapsed_seconds: number;
  error_message: string;
  created_at: string;
}

export interface PaperDetail extends PaperSummary {
  pdf_url: string;
  markdown_url: string | null;
  has_markdown: boolean;
  note_url: string | null;
  has_note: boolean;
  note_version: number;
}

export interface ChatConfig {
  models: string[];
  default_model: string;
  context_limit: number;
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

export interface ChatSendPayload {
  content: string;
  conversation_id?: number;
  model: string;
  enable_thinking: boolean;
  enable_search: boolean;
  attachments: { path: string; name: string }[];
}

export interface NoteRefinePayload {
  conversation_id: number;
  scope: "turn" | "conversation";
  intent?: "refine" | "expand" | "compare" | "summarize";
  assistant_message_id?: number;
  model?: string;
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

  listPapers: () => request<PaperSummary[]>("/api/papers"),

  getPaper: (id: number) => request<PaperDetail>(`/api/papers/${id}`),

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

  fetchNote: async (id: number) => {
    const token = getToken();
    const res = await fetch(`/api/papers/${id}/note`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("解读笔记未就绪");
    return res.text();
  },

  updateNote: (id: number, content: string) =>
    request<{ ok: boolean; note_version: number }>(`/api/papers/${id}/note`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  regenerateNote: (id: number) =>
    request<{ status: string }>(`/api/papers/${id}/note/regenerate`, {
      method: "POST",
    }),

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

  applyRefinedNote: (id: number, content: string, model?: string) =>
    request<{ ok: boolean; note_version: number; previous_version: number }>(
      `/api/papers/${id}/note/refine/apply`,
      {
        method: "POST",
        body: JSON.stringify({ content, model: model || "" }),
      }
    ),

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

export function buildPaperFileUrl(paperId: number, relPath: string): string {
  const clean = relPath.replace(/^\.?\/?/, "");
  return withToken(`/api/papers/${paperId}/files/${clean}`);
}

export function buildPaperPdfUrl(paperId: number): string {
  return withToken(`/api/papers/${paperId}/pdf`);
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
