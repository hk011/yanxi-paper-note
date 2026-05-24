export type StreamEventType =
  | "status"
  | "thinking"
  | "tool_start"
  | "tool_delta"
  | "tool_end"
  | "content"
  | "references"
  | "usage"
  | "suggestions"
  | "done";

export type SectionRunStatus = "pending" | "running" | "done" | "error";
export type NotePipelinePhase = "outline" | "draft" | "final" | "";

export interface StreamEvent {
  type: StreamEventType | string;
  status?: string;
  section?: string;
  section_id?: string;
  section_status?: SectionRunStatus;
  phase?: NotePipelinePhase;
  delta?: string;
  snapshot?: boolean;
  tool?: string;
  call_id?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  query?: string;
  hits?: unknown[];
  items?: unknown[];
  error?: string;
  parsed_pages?: number;
  total_pages?: number;
  mineru_state?: string;
  parse_elapsed_seconds?: number;
  prompt_tokens?: number;
  merged_content?: string;
  model?: string;
  heading?: string;
  note_version?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ToolTraceItem {
  key: string;
  tool: string;
  callId: string;
  status: "pending" | "success" | "error";
  title: string;
  description?: string;
  content?: string;
  input?: Record<string, unknown>;
  hits?: unknown[];
}

export interface TimelineItem {
  key: string;
  kind: "thinking" | "tool";
  status?: "pending" | "success" | "error";
  tool?: string;
  callId?: string;
  content?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  hits?: unknown[];
}
