import { useCallback, useEffect, useMemo, useState } from "react";
import { getCatalog, getVersion, getWorkflow, listWorkflows } from "../api";
import type { WorkflowSummary } from "../api/types";
import { useFetch } from "../api/use-fetch";
import { Callout } from "../components/callout";
import { navigate, useRoute } from "../route";
import { useEditor } from "../state/use-editor";
import {
  canSave,
  issuesByNode,
  latestOfList,
  nextVersion,
  workflowIssues,
} from "../state/workflow-ops";
import { useWaiting } from "../waiting/use-waiting";
import { waitingCount } from "../waiting/waiting";
import { Hud } from "../workspace/hud";
import { usePanelCollapsed } from "../workspace/panel-state";
import { useActions } from "../workspace/use-actions";
import { useEditing } from "../workspace/use-editing";
import { useNote } from "../workspace/use-note";
import { useRunList } from "../workspace/use-run-list";
import { useRunMode } from "../workspace/use-run-mode";
import { useTriggerInfo } from "../workspace/use-trigger-info";
import { useValidation } from "../workspace/use-validation";
import { WorkflowPanel } from "../workspace/workflow-panel";
import { Canvas } from "./canvas";
import type { TriggerApi } from "./edit-api";
import type { SelectApi } from "./select-api";

const NO_ITEMS: readonly never[] = [];

function useWorkflowData(workflowId: string | null, routeVersion: number | null) {
  const id = workflowId ?? "";
  const summary = useFetch(
    workflowId === null ? null : (signal) => getWorkflow(id, signal),
    `summary:${id}`,
  );
  const summaryN = summary.data?.id === workflowId ? summary.data.latest_version : null;
  const openedN = routeVersion ?? summaryN;
  const opened = useFetch(
    workflowId === null || openedN === null ? null : (signal) => getVersion(id, openedN, signal),
    `opened:${id}:${openedN}`,
  );
  return { summary, opened, summaryN, openedN };
}

type Editor = ReturnType<typeof useEditor>;
type Data = ReturnType<typeof useWorkflowData>;
type Actions = ReturnType<typeof useActions>;
type WorkflowList = ReturnType<typeof useWorkflowList>;
type Route = ReturnType<typeof useRoute>;
type RunMode = ReturnType<typeof useRunMode>;

function useWorkflowList() {
  return useFetch(listWorkflows, "workflows");
}

interface SyncOptions {
  readonly route: Route;
  readonly workflowId: string | null;
  readonly runId: string | null;
  readonly loaded: boolean;
  readonly editor: Editor;
  readonly opened: Data["opened"]["data"];
  readonly listData: WorkflowList["data"];
  readonly clearIssues: () => void;
}

function useWorkspaceSync(options: SyncOptions): void {
  const { route, workflowId, runId, loaded, editor, opened, listData, clearIssues } = options;
  const { state, dispatch, load } = editor;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the workflow changes
  useEffect(() => {
    clearIssues();
  }, [workflowId, clearIssues]);

  useEffect(() => {
    if (workflowId === null || opened === null || opened.id !== workflowId) return;
    if (state.workflowId !== workflowId || state.baseVersion !== opened.version) {
      load(workflowId, opened);
    }
  }, [workflowId, opened, state.workflowId, state.baseVersion, load]);

  useEffect(() => {
    if (!loaded) return;
    if (runId) dispatch({ type: "enterRun", runId });
    else dispatch({ type: "exitRun" });
  }, [loaded, runId, dispatch]);

  useEffect(() => {
    if (route.kind !== "home" || listData === null) return;
    const recent = latestOfList(listData);
    if (recent !== null)
      navigate({ kind: "workflow", id: recent, version: null, runId: null }, { replace: true });
  }, [route.kind, listData]);
}

interface DerivedOptions {
  readonly editor: Editor;
  readonly workflowId: string | null;
  readonly loaded: boolean;
  readonly actions: Actions;
  readonly runId: string | null;
  readonly runMode: RunMode;
  readonly workflows: readonly WorkflowSummary[];
  readonly notify: (text: string) => void;
  readonly triggers: TriggerApi;
}

function useDerived(options: DerivedOptions) {
  const { editor, workflowId, loaded, actions, runId, runMode, workflows, notify, triggers } =
    options;
  const { state, dispatch } = editor;
  const editable = loaded && state.mode.kind === "edit";
  const catalog = useFetch(getCatalog, "catalog");
  const checked = useValidation(workflowId, state.workflow, editable);
  const allIssues = checked.length > 0 ? checked : actions.issues;
  const issues = useMemo(() => issuesByNode(allIssues), [allIssues]);
  const general = useMemo(() => workflowIssues(allIssues), [allIssues]);
  const runInput = runMode.input;
  const edit = useEditing({
    state,
    dispatch,
    catalog: catalog.data,
    editable,
    runInput,
    workflowId,
    workflows,
    notify,
    triggers,
  });
  const display = runId !== null ? runMode.runShown : null;
  const empty = runId !== null && display === null;
  const nodes = empty ? NO_ITEMS : (display?.nodes ?? state.workflow.nodes);
  const edges = empty ? NO_ITEMS : (display?.edges ?? state.workflow.edges ?? []);
  return { issues, general, edit, nodes, edges };
}

function useRefresh(list: WorkflowList, data: Data): () => void {
  const { refetch: refetchList } = list;
  const { refetch: refetchSummary } = data.summary;
  return useCallback(() => {
    refetchList();
    refetchSummary();
  }, [refetchList, refetchSummary]);
}

function useLatestVersion(workflowId: string | null, summaryN: number | null) {
  const [top, setTop] = useState<{ readonly id: string; readonly version: number } | null>(null);
  const saved = top !== null && top.id === workflowId ? top.version : 0;
  const latest = Math.max(summaryN ?? 0, saved);
  const remember = useCallback(
    (version: number) => {
      if (workflowId !== null) setTop({ id: workflowId, version });
    },
    [workflowId],
  );
  return { latest: latest === 0 ? null : latest, remember };
}

function useWorkspace() {
  const route = useRoute();
  const workflowId = route.kind === "workflow" ? route.id : null;
  const routeVersion = route.kind === "workflow" ? route.version : null;
  const runId = route.kind === "workflow" || route.kind === "home" ? route.runId : null;
  const editor = useEditor();
  const { state, dispatch } = editor;
  const list = useWorkflowList();
  const data = useWorkflowData(workflowId, routeVersion);
  const { latest, remember } = useLatestVersion(workflowId, data.summaryN);
  const runList = useRunList();
  const refresh = useRefresh(list, data);
  const { note, notify } = useNote();
  const triggers = useTriggerInfo(workflowId, latest);
  const onSaved = useCallback(
    (version: number) => {
      remember(version);
      dispatch({ type: "markSaved", version });
      if (workflowId !== null) {
        navigate({ kind: "workflow", id: workflowId, version, runId: null });
      }
    },
    [dispatch, remember, workflowId],
  );
  const loaded =
    workflowId !== null && state.workflowId === workflowId && state.baseVersion === data.openedN;
  const actions = useActions({
    workflowId,
    workflow: state.workflow,
    summaries: list.data ?? NO_ITEMS,
    onSaved,
    refresh,
  });
  const { clearIssues, gone } = actions;
  const listData = useMemo(
    () => (list.data === null ? null : list.data.filter((item) => !gone.includes(item.id))),
    [list.data, gone],
  );
  useWorkspaceSync({
    route,
    workflowId,
    runId,
    loaded,
    editor,
    opened: data.opened.data,
    listData,
    clearIssues,
  });
  const summaryName = data.summary.data?.id === workflowId ? data.summary.data.name : null;
  const runMode = useRunMode({
    workflowId,
    runId,
    dirty: editor.dirty,
    openedVersion: data.openedN,
    latest,
    onEdit: () =>
      workflowId === null
        ? undefined
        : navigate({ kind: "workflow", id: workflowId, version: routeVersion, runId: null }),
    selection: state.selection,
    dispatch,
    refreshRuns: runList.refetch,
    openedNodes: data.opened.data?.nodes ?? NO_ITEMS,
  });
  const derived = useDerived({
    editor,
    workflowId,
    loaded,
    actions,
    runId,
    runMode,
    workflows: listData ?? NO_ITEMS,
    notify,
    triggers,
  });
  return {
    ...derived,
    note,
    editor,
    list,
    data,
    actions,
    workflowId,
    routeVersion,
    runId,
    loaded,
    latest,
    summaryName,
    runMode,
    runList,
  };
}

type Model = ReturnType<typeof useWorkspace>;

function EmptyWorkspace() {
  return (
    <div className="cv-empty">
      <p className="muted">Select a workflow in the list, or create one.</p>
    </div>
  );
}

interface BoxToolProps {
  readonly boxTool: boolean;
  readonly onBoxTool: (on: boolean) => void;
}

function WorkflowHud({
  model,
  boxTool,
  onBoxTool,
}: BoxToolProps & {
  readonly model: Model;
}) {
  const { editor, actions, data, latest, summaryName, general } = model;
  const { state, dirty } = editor;
  const name = summaryName ?? state.workflow.name;
  const editing = state.mode.kind === "edit";
  const save = {
    dirty,
    opened: data.openedN,
    latest,
    saving: actions.saving,
  };
  return (
    <Hud
      name={name}
      version={data.openedN}
      dirty={dirty}
      runMode={!editing}
      saving={actions.saving}
      canSave={canSave(save) && editing}
      saveLabel={`Save as v${nextVersion(latest)}`}
      issues={general}
      onRename={actions.rename}
      onSave={() => actions.save(name)}
      runButton={model.runMode.runButton}
      runBar={model.runMode.runBar}
      tools={{
        canUndo: editing && state.past.length > 0,
        canRedo: editing && state.future.length > 0,
        onUndo: () => model.editor.dispatch({ type: "undo" }),
        onRedo: () => model.editor.dispatch({ type: "redo" }),
        edit: model.edit,
        boxTool,
        onBoxTool,
      }}
    />
  );
}

export function Workspace() {
  const model = useWorkspace();
  const { editor, list, data, actions, workflowId, loaded } = model;
  const { state, dispatch } = editor;
  const waiting = useWaiting();
  const [collapsed, setCollapsed] = usePanelCollapsed();
  const [boxTool, setBoxTool] = useState(false);
  const select = useMemo<SelectApi>(
    () => ({
      set: (selection) => dispatch({ type: "select", selection }),
      toggle: (id) => dispatch({ type: "toggleNode", id }),
      many: (ids) => dispatch({ type: "selectNodes", ids }),
    }),
    [dispatch],
  );
  return (
    <div className="workspace" data-panel={collapsed ? "collapsed" : "open"}>
      <WorkflowPanel
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onRename={actions.renameById}
        onRemove={actions.remove}
        list={list}
        activeId={workflowId}
        openedVersion={data.openedN}
        waitingCount={waitingCount(waiting)}
        runList={model.runList}
        activeRunId={model.runId}
        busy={actions.busy}
        onRetry={list.refetch}
        onNew={actions.createNew}
        onDuplicate={actions.duplicate}
      />
      <main className="workspace-canvas">
        {workflowId === null ? (
          <EmptyWorkspace />
        ) : (
          <>
            <Canvas
              nodes={loaded ? model.nodes : NO_ITEMS}
              edges={loaded ? model.edges : NO_ITEMS}
              selection={state.selection}
              select={select}
              boxTool={boxTool}
              edit={model.edit}
              invalid={model.issues}
              {...(model.runMode.runApi ? { run: model.runMode.runApi } : {})}
            />
            {loaded ? <WorkflowHud model={model} boxTool={boxTool} onBoxTool={setBoxTool} /> : null}
          </>
        )}
        <Notices
          loadError={data.summary.error ?? data.opened.error}
          noVersion={data.summary.data?.id === workflowId && data.summaryN === null}
          actionError={actions.error ?? model.runMode.runError}
          issues={actions.issues}
          note={model.note}
        />
      </main>
    </div>
  );
}

interface NoticesProps {
  readonly loadError: Error | null;
  readonly noVersion: boolean;
  readonly actionError: string | null;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
  readonly note: string | null;
}

function Notices({ loadError, noVersion, actionError, issues, note }: NoticesProps) {
  const text = loadError?.message ?? actionError;
  if (text === null && !noVersion && issues.length === 0 && note === null) return null;
  return (
    <div className="hud-notice">
      {note === null ? null : (
        <p className="hud-quiet" role="status">
          {note}
        </p>
      )}
      {text !== null && text !== undefined ? (
        <Callout tone="danger" title="Request failed">
          {text}
        </Callout>
      ) : null}
      {noVersion ? (
        <Callout tone="warning" title="No saved version">
          This workflow has no version yet.
        </Callout>
      ) : null}
      {issues.length > 0 ? (
        <Callout tone="danger" title="Save refused">
          {issues.map((issue) => issue.message).join(" ")}
        </Callout>
      ) : null}
    </div>
  );
}
