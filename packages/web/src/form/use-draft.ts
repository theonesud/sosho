import { useCallback, useEffect, useRef, useState } from "react";
import { isJsonObject, isNode } from "../api/guards";
import type { JsonObject, Node } from "../api/types";

const DEBOUNCE_MS = 350;

export function toObject(node: Node): JsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(node));
  return isJsonObject(parsed) ? parsed : {};
}

export function useDraft(node: Node, onCommit: (node: Node) => void) {
  const [draft, setDraft] = useState<JsonObject>(() => toObject(node));
  const latest = useRef(draft);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    if (isNode(latest.current)) commit.current(latest.current);
  }, []);

  const change = useCallback(
    (next: JsonObject, immediate = false) => {
      latest.current = next;
      pending.current = true;
      setDraft(next);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = immediate ? null : setTimeout(flush, DEBOUNCE_MS);
      if (immediate) flush();
    },
    [flush],
  );

  useEffect(() => {
    if (pending.current) return;
    const next = toObject(node);
    latest.current = next;
    setDraft(next);
  }, [node]);

  useEffect(() => flush, [flush]);

  return { draft, change, flush };
}
