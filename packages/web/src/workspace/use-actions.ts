import { useCallback, useMemo, useState } from "react";
import {
  ApiError,
  createWorkflow,
  deleteWorkflow,
  getVersion,
  type Issue,
  type Node,
  saveVersion,
  updateWorkflow,
  type WorkflowDraft,
  type WorkflowSummary,
} from "../api";
import { navigate } from "../route";
import { toDraft } from "../state/graph";
import {
  duplicateId,
  duplicateName,
  freshIssues,
  MAX_NAME,
  minimalDraft,
  newWorkflowId,
} from "../state/workflow-ops";
import { deleteFailure, nextAfterDelete } from "./panel-state";

interface ActionDeps {
  readonly workflowId: string | null;
  readonly workflow: WorkflowDraft;
  readonly summaries: readonly WorkflowSummary[];
  readonly onSaved: (version: number) => void;
  readonly refresh: () => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type SetFlag = (value: boolean) => void;
type SetError = (value: string | null) => void;

export interface DuplicateSource {
  readonly id: string;
  readonly name: string;
  readonly version: number;
}

function useCreateActions(deps: ActionDeps, setBusy: SetFlag, setError: SetError) {
  const { summaries, refresh } = deps;

  const create = useCallback(
    async (id: string, name: string, load: () => Promise<WorkflowDraft>) => {
      setBusy(true);
      setError(null);
      try {
        const draft = await load();
        await createWorkflow({ id, name });
        const saved = await saveVersion(id, { ...draft, name });
        refresh();
        navigate({ kind: "workflow", id, version: saved.version, runId: null });
      } catch (caught) {
        setError(messageOf(caught));
      } finally {
        setBusy(false);
      }
    },
    [refresh, setBusy, setError],
  );

  const createNew = useCallback(
    () =>
      create(newWorkflowId(Date.now()), "New workflow", () =>
        Promise.resolve(minimalDraft("New workflow")),
      ),
    [create],
  );

  const duplicate = useCallback(
    (source: DuplicateSource) => {
      const taken = new Set(summaries.map((item) => item.id));
      return create(duplicateId(source.id, taken), duplicateName(source.name), async () =>
        toDraft(await getVersion(source.id, source.version)),
      );
    },
    [create, summaries],
  );

  return { createNew, duplicate };
}

function useSaveActions(
  deps: ActionDeps,
  setSaving: SetFlag,
  setError: SetError,
  setIssues: (issues: readonly Issue[], nodes: readonly Node[]) => void,
) {
  const { workflowId, workflow, onSaved, refresh } = deps;

  const save = useCallback(
    async (name: string): Promise<number | null> => {
      if (workflowId === null) return null;
      setSaving(true);
      setError(null);
      try {
        const saved = await saveVersion(workflowId, {
          ...workflow,
          name: name.slice(0, MAX_NAME) || workflow.name,
        });
        setIssues([], workflow.nodes);
        onSaved(saved.version);
        refresh();
        return saved.version;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 422) {
          setIssues(caught.issues, workflow.nodes);
          setError(caught.issues.length === 0 ? caught.message : null);
        } else setError(messageOf(caught));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [workflowId, workflow, onSaved, refresh, setSaving, setError, setIssues],
  );

  const renameById = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      try {
        await updateWorkflow(id, { name });
        refresh();
        return null;
      } catch (caught) {
        return messageOf(caught);
      }
    },
    [refresh],
  );

  const rename = useCallback(
    (name: string): Promise<string | null> =>
      workflowId === null ? Promise.resolve("No workflow is open.") : renameById(workflowId, name),
    [workflowId, renameById],
  );

  return { save, rename, renameById };
}

function useDeleteAction(deps: ActionDeps) {
  const { workflowId, summaries, refresh } = deps;
  const [gone, setGone] = useState<readonly string[]>([]);
  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        await deleteWorkflow(id);
      } catch (caught) {
        return deleteFailure(caught);
      }
      setGone((ids) => [...ids, id]);
      if (id === workflowId) {
        const next = nextAfterDelete(summaries, id);
        if (next === null) navigate({ kind: "home", runId: null }, { replace: true });
        else navigate({ kind: "workflow", id: next, version: null, runId: null });
      }
      refresh();
      return null;
    },
    [workflowId, summaries, refresh],
  );
  return { gone, remove };
}

interface Refused {
  readonly issues: readonly Issue[];
  readonly nodes: readonly Node[];
}

const NO_ISSUES: Refused = { issues: [], nodes: [] };

export function useActions(deps: ActionDeps) {
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>(NO_ISSUES);
  const [error, setError] = useState<string | null>(null);
  const setIssues = useCallback(
    (list: readonly Issue[], nodes: readonly Node[]) => setRefused({ issues: list, nodes }),
    [],
  );
  const clearIssues = useCallback(() => setRefused(NO_ISSUES), []);
  const currentNodes = deps.workflow.nodes;
  const issues = useMemo(
    () => freshIssues(refused.issues, refused.nodes, currentNodes),
    [refused, currentNodes],
  );
  const { createNew, duplicate } = useCreateActions(deps, setBusy, setError);
  const { save, rename, renameById } = useSaveActions(deps, setSaving, setError, setIssues);
  const { gone, remove } = useDeleteAction(deps);

  return {
    saving,
    busy,
    issues,
    error,
    clearIssues,
    createNew,
    duplicate,
    save,
    rename,
    renameById,
    gone,
    remove,
  };
}
