export type PlaygroundMode = "chat" | "compare" | "skill";

export const PLAYGROUND_TIERS = ["main", "subagent", "subagent-code", "decision", "local-uncensored", "embed"] as const;

export type PlaygroundTier = (typeof PLAYGROUND_TIERS)[number];

export interface RoleInfo {
  provider: string;
  model: string;
  description?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface StreamOutputState {
  status: "idle" | "streaming" | "done" | "aborted" | "error";
  content: string;
  error: string | null;
  provider?: string;
  model?: string;
  durationMs?: number;
  tokensPerSec?: number;
  completionTokens?: number;
  fallbackUsed?: boolean;
  startedAt?: number;
  chunkCount: number;
}

export function createIdleStreamState(): StreamOutputState {
  return {
    status: "idle",
    content: "",
    error: null,
    chunkCount: 0,
  };
}

export type PlaygroundSseEvent =
  | {
      type: "delta";
      content: string;
      slot?: 0 | 1;
      role?: string;
    }
  | {
      type: "done";
      content: string;
      provider: string;
      model: string;
      durationMs: number;
      usage?: StreamUsage;
      fallbackUsed?: boolean;
      slot?: 0 | 1;
      role?: string;
    }
  | {
      type: "error";
      message: string;
      slot?: 0 | 1;
      role?: string;
    };
