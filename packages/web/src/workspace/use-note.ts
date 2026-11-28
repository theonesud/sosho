import { useCallback, useEffect, useState } from "react";

const NOTE_MS = 4000;

export function useNote() {
  const [note, setNote] = useState<{ readonly text: string; readonly at: number } | null>(null);
  const notify = useCallback((text: string) => setNote({ text, at: Date.now() }), []);
  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  return { note: note?.text ?? null, notify };
}
