import { createHash } from "node:crypto";

export const DEFAULT_MAX_CHARS = 20000;

export interface TruncationMeta {
  truncated: boolean;
  orig_len: number;
  kept_len?: number;
  sha256?: string;
}

export function truncateText(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): { text: string; meta: TruncationMeta } {
  if (text.length <= maxChars) {
    return { text, meta: { truncated: false, orig_len: text.length } };
  }
  return {
    text: text.slice(0, maxChars),
    meta: {
      truncated: true,
      orig_len: text.length,
      kept_len: maxChars,
      sha256: createHash("sha256").update(text).digest("hex"),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

export function extractToolCalls(content: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(content)) return [];
  const calls: Array<{ id: string; name: string }> = [];
  for (const part of content) {
    if (
      isRecord(part) &&
      part.type === "toolCall" &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      calls.push({ id: part.id, name: part.name });
    }
  }
  return calls;
}

export function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
