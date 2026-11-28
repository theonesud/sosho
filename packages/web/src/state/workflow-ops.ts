import { isRecord } from "../api/guards";
import type { Issue, Node, WorkflowDraft } from "../api/types";
import { uniqueId } from "./graph";

export const MAX_NAME = 200;

export function minimalDraft(name: string): WorkflowDraft {
  return {
    name,
    nodes: [{ id: "start", kind: "trigger", mode: "manual" }],
    edges: [],
    entry: "start",
  };
}

export function newWorkflowId(now: number): string {
  return `wf-${now.toString(36)}`;
}

export function duplicateId(id: string, taken: ReadonlySet<string>): string {
  return uniqueId(`${id}-copy`, taken);
}

export function duplicateName(name: string): string {
  return `${name} copy`.slice(0, MAX_NAME);
}

export function issuesByNode(issues: readonly Issue[]): ReadonlyMap<string, readonly Issue[]> {
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (issue.node === null) continue;
    grouped.set(issue.node, [...(grouped.get(issue.node) ?? []), issue]);
  }
  return grouped;
}

export function freshIssues(
  issues: readonly Issue[],
  checked: readonly Node[],
  current: readonly Node[],
): readonly Issue[] {
  if (checked === current || issues.length === 0) return issues;
  const before = new Map(checked.map((node) => [node.id, node]));
  const now = new Map(current.map((node) => [node.id, node]));
  return issues.filter(
    (issue) => issue.node === null || before.get(issue.node) === now.get(issue.node),
  );
}

export function workflowIssues(issues: readonly Issue[]): readonly string[] {
  return issues.filter((issue) => issue.node === null).map((issue) => issue.message);
}

function describeDetail(entry: unknown, nodes: readonly { readonly id: string }[]): Issue | null {
  if (!isRecord(entry) || !Array.isArray(entry.loc) || typeof entry.msg !== "string") return null;
  const loc = entry.loc.slice(entry.loc[0] === "body" ? 1 : 0);
  const draftAt = loc[0] === "draft" ? 1 : 0;
  const rest = loc.slice(draftAt);
  const index = rest[0] === "nodes" ? rest[1] : undefined;
  const node = typeof index === "number" ? (nodes[index]?.id ?? null) : null;
  const path = node === null ? rest : rest.slice(3);
  const where = path.length > 0 ? `${path.join(".")}: ` : "";
  const field = node !== null && typeof path[0] === "string" ? { field: path[0] } : {};
  return { code: String(entry.type ?? "invalid"), message: `${where}${entry.msg}`, node, ...field };
}

export function issuesFromDetail(
  body: unknown,
  nodes: readonly { readonly id: string }[],
): readonly Issue[] {
  if (!isRecord(body) || !Array.isArray(body.detail)) return [];
  return body.detail
    .map((entry) => describeDetail(entry, nodes))
    .filter((issue): issue is Issue => issue !== null);
}

export interface SaveState {
  readonly dirty: boolean;
  readonly opened: number | null;
  readonly latest: number | null;
  readonly saving: boolean;
}

export const nextVersion = (latest: number | null): number => (latest ?? 0) + 1;

export function canSave({ dirty, opened, latest, saving }: SaveState): boolean {
  return !saving && (dirty || opened !== latest);
}

export function latestOfList(
  items: readonly { readonly id: string; readonly created_at: string }[],
): string | null {
  let best: { readonly id: string; readonly created_at: string } | null = null;
  for (const item of items) {
    if (best === null || item.created_at > best.created_at) best = item;
  }
  return best?.id ?? null;
}
