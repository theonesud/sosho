import type { Catalog, Node, TriggerInfo, WorkflowSummary } from "../api/types";
import type { RunInputApi } from "../run/trigger-input";
import type { EdgePatch } from "../state/reducer";

export interface TriggerApi {
  readonly info: TriggerInfo | null;
  readonly refresh: () => void;
}

export interface EditApi {
  readonly triggers: TriggerApi;
  readonly editable: boolean;
  readonly catalog: Catalog | null;
  readonly runInput: RunInputApi;
  readonly hasTrigger: boolean;
  readonly workflowId: string | null;
  readonly workflows: readonly WorkflowSummary[];
  readonly nodeCount: number;
  readonly selectedCount: number;
  readonly canDelete: boolean;
  readonly canPaste: boolean;
  readonly copy: () => Promise<void>;
  readonly paste: () => void;
  readonly duplicate: () => void;
  readonly deleteSelected: () => void;
  readonly selectAll: () => void;
  readonly updateNode: (id: string, node: Node) => void;
  readonly deleteNode: (id: string) => void;
  readonly addAfter: (from: string, kind: string) => void;
  readonly connect: (source: string, target: string) => void;
  readonly patchEdge: (id: string, patch: EdgePatch) => void;
}
