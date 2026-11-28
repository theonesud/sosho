import { isEdge, isNode, isRecord } from "../api/guards";
import type { Edge, Node, Workflow, WorkflowDraft } from "../api/types";

const MAX_ID = 64;
const CLIPBOARD_TAG = "sosho.nodes";

export function toDraft(source: WorkflowDraft | Workflow): WorkflowDraft {
  const draft: WorkflowDraft = {
    name: source.name,
    nodes: source.nodes,
    edges: source.edges ?? [],
    entry: source.entry,
  };
  return {
    ...draft,
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.policy !== undefined ? { policy: source.policy } : {}),
  };
}

export function emptyDraft(): WorkflowDraft {
  return { name: "", nodes: [], edges: [], entry: "" };
}

export function edgeKey(edge: Pick<Edge, "source" | "target">): string {
  return `${edge.source}>${edge.target}`;
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_ID - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function copySelection(workflow: WorkflowDraft, ids: readonly string[]): string | null {
  const chosen = new Set(ids);
  const nodes = workflow.nodes.filter((node) => chosen.has(node.id));
  if (nodes.length === 0) return null;
  const edges = (workflow.edges ?? []).filter(
    (edge) => chosen.has(edge.source) && chosen.has(edge.target),
  );
  return JSON.stringify({ tag: CLIPBOARD_TAG, nodes, edges });
}

export interface Pasted {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
}

export function parseClipboard(
  text: string,
): { nodes: readonly Node[]; edges: readonly Edge[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.tag !== CLIPBOARD_TAG) return null;
  const { nodes, edges } = parsed;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  if (!nodes.every(isNode) || !edges.every(isEdge)) return null;
  return nodes.length > 0 ? { nodes, edges } : null;
}

export function reid(clip: Pasted, taken: ReadonlySet<string>): Pasted {
  const used = new Set(taken);
  const map = new Map<string, string>();
  for (const node of clip.nodes) {
    const id = uniqueId(node.id, used);
    used.add(id);
    map.set(node.id, id);
  }
  const rename = (id: string) => map.get(id) ?? id;
  return {
    nodes: clip.nodes.map((node) => ({ ...node, id: rename(node.id) })),
    edges: clip.edges.map((edge) => ({
      ...edge,
      source: rename(edge.source),
      target: rename(edge.target),
    })),
  };
}

export interface PastePlan extends Pasted {
  readonly skippedTrigger: boolean;
}

export function hasTrigger(workflow: WorkflowDraft): boolean {
  return workflow.nodes.some((node) => node.kind === "trigger");
}

export function planPaste(workflow: WorkflowDraft, text: string): PastePlan | null {
  const clip = parseClipboard(text);
  if (!clip) return null;
  let triggerTaken = hasTrigger(workflow);
  let skippedTrigger = false;
  const kept: Node[] = [];
  for (const node of clip.nodes) {
    if (node.kind === "trigger") {
      if (triggerTaken) {
        skippedTrigger = true;
        continue;
      }
      triggerTaken = true;
    }
    kept.push(node);
  }
  const keptIds = new Set(kept.map((node) => node.id));
  const edges = clip.edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));
  const placed = reid({ nodes: kept, edges }, new Set(workflow.nodes.map((node) => node.id)));
  return { ...placed, skippedTrigger };
}
