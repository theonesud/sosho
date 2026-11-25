import type { Context } from "hono";
import type { ZodType } from "zod";
import type { WorkflowEngine } from "@sosho/workflow-engine";
import type { SseHub } from "./sse.ts";

export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface StudioContext {
  root: string;
  workflowsDir: string;
  skillsDir: string;
  port: number;
  engine: WorkflowEngine;
  sse: SseHub;
  langgraphUrl?: string;
  langflowUrl?: string;
}

export function isSafeWorkflowId(id: string): boolean {
  if (!id || id.length > 128) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..") || id.includes("\0")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Payload too large (max 1 MiB)");
  }
  const raw = new TextDecoder().decode(buf).trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON payload");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

export async function parseValidatedBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const raw = await readJsonObject(c);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, "Validation failed", result.error.flatten());
  }
  return result.data;
}
