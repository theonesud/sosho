export type MemoryScope = "global" | "project";
export type MemoryType = "semantic" | "procedural" | "episodic" | "entity";
export type MemoryStatus = "active" | "superseded" | "archived" | "needs_review";

export interface MemorySource {
  session_id?: string;
  langfuse_trace_id?: string;
  note?: string;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  entities: string[];
  importance: number;
  confidence: number;
  status: MemoryStatus;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  access_count: number;
  last_accessed: string;
  sources: MemorySource[];
  filePath?: string;
}

export interface MemorySearchOptions {
  query: string;
  scope?: MemoryScope | "both";
  types?: MemoryType[];
  limit?: number;
  maxTokens?: number;
  includeArchived?: boolean;
  embedUrl?: string;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  lexicalScore: number;
  vectorScore: number;
  graphBoost: number;
}

export interface UpsertMemoryInput {
  scope: MemoryScope;
  type: MemoryType;
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
  confidence?: number;
  supersedes_id?: string;
  source?: MemorySource;
}

export interface InboxEvent {
  timestamp: string;
  scope: MemoryScope;
  kind: "session_summary" | "task_finish" | "user_correction" | "workflow_outcome" | "manual";
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  source?: MemorySource;
}

export interface ScratchpadTaskHistoryItem {
  title: string;
  goal: string;
  summary: string;
  completed: number;
  total: number;
  finished_at?: string;
}
