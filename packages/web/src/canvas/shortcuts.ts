export type Shortcut = "undo" | "redo" | "delete" | "escape" | "selectAll" | "duplicate";

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export interface ShortcutContext {
  readonly editable: boolean;
  readonly typing: boolean;
}

const TEXT_TARGET = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_TARGET) !== null;
}

const FORM_TARGET = "[data-no-pan], [role='listbox'], [role='menu'], [role='dialog']";

export function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(FORM_TARGET) !== null;
}

export function resolveShortcut(input: KeyInput, context: ShortcutContext): Shortcut | null {
  if (input.key === "Escape") return "escape";
  if (context.typing || !context.editable || input.altKey) return null;
  const modifier = input.ctrlKey || input.metaKey;
  const letter = input.key.toLowerCase();
  if (modifier && letter === "z") return input.shiftKey ? "redo" : "undo";
  if (modifier && letter === "y" && !input.shiftKey) return "redo";
  if (modifier && !input.shiftKey && letter === "a") return "selectAll";
  if (modifier && !input.shiftKey && letter === "d") return "duplicate";
  if (!modifier && (input.key === "Delete" || input.key === "Backspace")) return "delete";
  return null;
}

export function clipboardAllowed(context: ShortcutContext): boolean {
  return context.editable && !context.typing;
}
