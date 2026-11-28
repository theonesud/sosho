import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelRun, forkRun, getVersion, resumeRun, sendInput, startRun } from "../api/client";
import type { Node } from "../api/types";
import { useFetch } from "../api/use-fetch";
import type { RunApi } from "../canvas/run-api";
import { navigate } from "../route";
import type { ReplyFn } from "../run/human-panel";
import {
  loadRunInput,
  parseRunInput,
  rememberSentInput,
  saveRunInput,
  sentInput,
} from "../run/run-input";
import {
  availableActions,
  failureOf,
  forkTarget,
  isTerminal,
  nodeStep,
  pendingFor,
} from "../run/run-state";
import { useRun } from "../run/use-run";
import type { EditorAction, Selection } from "../state/reducer";
import { singleNode } from "../state/selection";
import { runButtonView } from "./run-button-model";
import type { RunBarProps, RunButtonProps } from "./run-controls";

interface RunModeOptions {
  readonly workflowId: string | null;
  readonly runId: string | null;
  readonly dirty: boolean;
  readonly openedVersion: number | null;
  readonly latest: number | null;
  readonly onEdit: () => void;
  readonly selection: Selection;
  readonly dispatch: (action: EditorAction) => void;
  readonly refreshRuns: () => void;
  readonly openedNodes: readonly Node[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function useRunInput(workflowId: string | null) {
  const [text, setText] = useState(() => (workflowId ? loadRunInput(workflowId) : "{}"));
  useEffect(() => {
    if (workflowId !== null) setText(loadRunInput(workflowId));
  }, [workflowId]);
  const onChange = useCallback(
    (next: string) => {
      setText(next);
      if (workflowId !== null) saveRunInput(workflowId, next);
    },
    [workflowId],
  );
  return { text, onChange };
}

const firstTriggerId = (nodes: readonly Node[]): string | null =>
  nodes.find((node) => node.kind === "trigger")?.id ?? null;

const humanIdsOf = (nodes: readonly Node[]): ReadonlySet<string> =>
  new Set(nodes.filter((node) => node.kind === "human").map((node) => node.id));

function useAutoExpand(
  runId: string | null,
  pending: readonly { readonly run_id: string; readonly node_id: string }[],
  dispatch: (action: EditorAction) => void,
) {
  const handled = useRef(new Set<string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: forget handled requests for a new run
  useEffect(() => {
    handled.current = new Set();
  }, [runId]);
  useEffect(() => {
    for (const item of pending) {
      if (handled.current.has(item.run_id)) continue;
      handled.current.add(item.run_id);
      dispatch({ type: "selectNodes", ids: [item.node_id] });
    }
  }, [pending, dispatch]);
}

export function useRunMode(options: RunModeOptions) {
  const { workflowId, runId, dirty, openedVersion, latest, selection, dispatch } = options;
  const run = useRun(runId);
  const { state, statuses, status, setHumanIds } = run;
  const detail = state.detail;
  const version = detail?.summary.version ?? null;
  const runWorkflow = useFetch(
    workflowId === null || runId === null || version === null
      ? null
      : (signal) => getVersion(workflowId, version, signal),
    `runwf:${workflowId}:${version}`,
  ).data;
  const shown = runWorkflow && runWorkflow.id === workflowId ? runWorkflow : null;
  const nodes = shown?.nodes;
  const input = useRunInput(workflowId);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setHumanIds(humanIdsOf(nodes ?? [])), [nodes, setHumanIds]);
  const pending = detail?.pending_human ?? [];
  useAutoExpand(runId, pending, dispatch);

  const parsed = parseRunInput(input.text);
  const { refreshRuns, openedNodes, onEdit } = options;
  const start = useCallback(async () => {
    if (workflowId === null || latest === null || !parsed.ok) return;
    setStarting(true);
    setError(null);
    try {
      const nodes =
        latest === openedVersion ? openedNodes : (await getVersion(workflowId, latest)).nodes;
      const triggerNode = firstTriggerId(nodes);
      const ref = await startRun(workflowId, {
        version: latest,
        input: parsed.value,
        ...(triggerNode === null ? {} : { trigger_node: triggerNode }),
      });
      rememberSentInput(ref.run_id, parsed.value);
      refreshRuns();
      navigate({
        kind: "workflow",
        id: workflowId,
        version: openedVersion ?? latest,
        runId: ref.run_id,
      });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }, [workflowId, latest, parsed, openedVersion, refreshRuns, openedNodes]);

  const guarded = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const { refresh, reopen } = run;
  const onCancel = () =>
    runId === null
      ? undefined
      : guarded(async () => {
          await cancelRun(runId);
          await refresh();
          refreshRuns();
        });
  const onResume = () =>
    runId === null
      ? undefined
      : guarded(async () => {
          await resumeRun(runId);
          reopen();
          await refresh();
          refreshRuns();
        });
  const triggerIds = useMemo(
    () => new Set((nodes ?? []).filter((node) => node.kind === "trigger").map((node) => node.id)),
    [nodes],
  );
  const selected = singleNode(selection);
  const forkNode = forkTarget(state, statuses, selected, triggerIds);
  const onFork = () =>
    runId === null || workflowId === null || forkNode === null
      ? undefined
      : guarded(async () => {
          const ref = await forkRun(runId, { node_id: forkNode });
          const sent = sentInput(runId);
          if (sent) rememberSentInput(ref.run_id, sent);
          refreshRuns();
          navigate({
            kind: "workflow",
            id: workflowId,
            version: detail?.summary.version ?? null,
            runId: ref.run_id,
          });
        });

  const reply: ReplyFn = useCallback(
    async (item, action, value) => {
      if (runId === null) return "No run is open.";
      try {
        await sendInput(runId, {
          node_id: item.node_id,
          reply: value === undefined ? { action } : { action, value },
        });
        await refresh();
        return null;
      } catch (caught) {
        return messageOf(caught);
      }
    },
    [runId, refresh],
  );

  const runApi: RunApi | undefined = useMemo(() => {
    if (runId === null) return undefined;
    const sent = sentInput(runId);
    return {
      statusOf: (id) => statuses.get(id),
      infoOf: (id) => ({
        status: statuses.get(id),
        step: nodeStep(detail, id),
        failure: statuses.get(id) === "failed" ? failureOf(state, id) : null,
        pending: isTerminal(status) ? null : pendingFor(state, id),
        input: triggerIds.has(id) ? sent : null,
        onReply: reply,
      }),
    };
  }, [runId, status, statuses, detail, state, triggerIds, reply]);

  const view = runButtonView({
    runMode: runId !== null,
    status,
    latest,
    dirty,
    inputError: parsed.ok ? null : "The run input is not valid JSON.",
    starting,
    busy,
  });
  const runButton: RunButtonProps = {
    view,
    starting,
    onClick: () => {
      if (view.kind === "run") void start();
      else if (view.kind === "cancel") void onCancel();
      else onEdit();
    },
  };
  const runBar: RunBarProps = {
    status,
    createdAt: detail?.summary.created_at ?? null,
    updatedAt: detail?.summary.updated_at ?? null,
    actions: availableActions(status, detail?.summary.dbos_status ?? null),
    forkNode,
    busy,
    onResume: () => void onResume(),
    onFork: () => void onFork(),
  };
  return {
    input,
    runApi,
    runButton,
    runBar,
    runShown: shown,
    runError: error ?? run.error,
  };
}
