import { isRecord, isRunEvent } from "./guards";
import type { RunEvent } from "./types";

export interface RunEventHandlers {
  readonly onEvent: (event: RunEvent) => void;
  readonly onEnd: () => void;
  readonly onError?: (reason: "connection" | "malformed") => void;
}

export interface RunEventStream {
  readonly close: () => void;
  readonly lastId: () => number;
}

export function parseRunEvent(data: string): RunEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  return isRecord(parsed) && isRunEvent(parsed) ? parsed : null;
}

export function openRunEvents(runId: string, handlers: RunEventHandlers): RunEventStream {
  const source = new EventSource(`/runs/${encodeURIComponent(runId)}/events`, {
    withCredentials: false,
  });
  let last = 0;
  let closed = false;

  const close = () => {
    closed = true;
    source.close();
  };

  source.onmessage = (message) => {
    const id = Number(message.lastEventId);
    if (Number.isFinite(id) && id > 0) {
      if (id <= last) return;
      last = id;
    }
    const event = parseRunEvent(message.data);
    if (event) handlers.onEvent(event);
    else handlers.onError?.("malformed");
  };
  source.addEventListener("end", () => {
    close();
    handlers.onEnd();
  });
  source.onerror = () => {
    if (!closed) handlers.onError?.("connection");
  };
  return { close, lastId: () => last };
}
