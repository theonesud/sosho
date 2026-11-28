export type Selection =
  | { readonly kind: "nodes"; readonly ids: readonly string[] }
  | { readonly kind: "edge"; readonly id: string }
  | { readonly kind: null };

export const NO_SELECTION: Selection = { kind: null };

export function nodesSelection(ids: readonly string[]): Selection {
  return ids.length === 0 ? NO_SELECTION : { kind: "nodes", ids };
}

export function selectedIds(selection: Selection): readonly string[] {
  return selection.kind === "nodes" ? selection.ids : [];
}

export function singleNode(selection: Selection): string | null {
  return selection.kind === "nodes" && selection.ids.length === 1
    ? (selection.ids[0] ?? null)
    : null;
}

export function toggleNode(selection: Selection, id: string): Selection {
  const ids = selectedIds(selection);
  return nodesSelection(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
}

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind === "nodes" && b.kind === "nodes") {
    return a.ids.length === b.ids.length && a.ids.every((id, at) => id === b.ids[at]);
  }
  if (a.kind === "edge" && b.kind === "edge") return a.id === b.id;
  return a.kind === b.kind;
}
