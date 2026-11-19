import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const MAX_SUBAGENT_DEPTH = 3;
export const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024; // 2 MiB

export class Semaphore {
  private readonly limit: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get activeCount(): number {
    return this.active;
  }

  get maxLimit(): number {
    return this.limit;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class TierSemaphoreRegistry {
  private readonly semaphores = new Map<string, Semaphore>();

  get(tier: string, limit: number): Semaphore {
    let sem = this.semaphores.get(tier);
    if (!sem) {
      sem = new Semaphore(limit);
      this.semaphores.set(tier, sem);
    }
    return sem;
  }

  clear(): void {
    this.semaphores.clear();
  }
}

export class BoundedBuffer {
  private readonly maxBytes: number;
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;
  private truncated = false;

  constructor(maxBytes: number = MAX_STREAM_BUFFER_BYTES) {
    this.maxBytes = maxBytes;
  }

  append(chunk: Buffer | string): void {
    if (this.truncated) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    const remaining = this.maxBytes - this.totalBytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (buf.length > remaining) {
      this.chunks.push(buf.subarray(0, remaining));
      this.totalBytes += remaining;
      this.truncated = true;
    } else {
      this.chunks.push(buf);
      this.totalBytes += buf.length;
    }
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString("utf8");
    return this.truncated ? `${text}\n...[stream truncated at ${this.maxBytes} bytes]` : text;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get isTruncated(): boolean {
    return this.truncated;
  }
}

export function getSubagentDepth(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SOSHO_SUBAGENT_DEPTH;
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function isSubagentDepthAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return getSubagentDepth(env) < MAX_SUBAGENT_DEPTH;
}

export function getSubagentOutputDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.SOSHO_PERMANENT_DIR
    ? join(env.SOSHO_PERMANENT_DIR, "subagents")
    : join(cwd, ".pi", "scratchpad", "subagents");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildSubagentCliArgs(provider: string, model: string, prompt: string): string[] {
  return ["--print", "--no-session", "--approve", "--provider", provider, "--model", model, prompt];
}
