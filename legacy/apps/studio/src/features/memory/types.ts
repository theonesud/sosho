export type MemoryScope = "project" | "global";
export type MemoryType = "semantic" | "procedural" | "episodic" | "entity";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  title: string;
  content: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
  access_count?: number;
  valid_from?: string;
  archived?: boolean;
  archived_reason?: string;
  supersedes_id?: string;
  score?: number;
  lexicalScore?: number;
  vectorScore?: number;
  graphBoost?: number;
}

export interface MemoryQueryResponse {
  items: MemoryRecord[];
  profiles: {
    global: string;
    project: string;
  };
}
