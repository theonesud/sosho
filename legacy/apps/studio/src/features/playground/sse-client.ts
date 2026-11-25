import { authHeaders } from "@/api";
import type { PlaygroundSseEvent } from "./types";

export async function consumeSsePost(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onEvent: (event: PlaygroundSseEvent) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errPayload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(errPayload.error || errPayload.message || `Request failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("Response stream is empty");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as PlaygroundSseEvent;
            onEvent(parsed);
          } catch {
            // ignore malformed frame
          }
        }
      }
    }

    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as PlaygroundSseEvent;
          onEvent(parsed);
        } catch {
          // ignore trailing incomplete frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
