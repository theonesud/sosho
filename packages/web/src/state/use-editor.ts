import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Workflow } from "../api/types";
import { clearDraft, loadDraft, saveDraft } from "./persist";
import { type EditorAction, initialState, isDirty, reduce } from "./reducer";

export function useEditor() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);

  const load = useCallback((workflowId: string, source: Workflow) => {
    const stored = loadDraft(workflowId, source.version);
    dispatch({
      type: "load",
      workflowId,
      baseline: source,
      baseVersion: source.version,
      ...(stored === null ? {} : { draft: stored.workflow }),
    });
  }, []);

  const { workflowId, workflow, baseVersion } = state;
  const dirty = isDirty(state);
  const base = useRef({ workflowId, baseVersion });
  base.current = { workflowId, baseVersion };
  useEffect(() => {
    if (workflowId === null) return;
    if (dirty) saveDraft(workflowId, { baseVersion, workflow });
    else clearDraft(workflowId, baseVersion);
  }, [workflowId, workflow, baseVersion, dirty]);

  const send = useCallback((action: EditorAction) => {
    if (action.type === "markSaved" && base.current.workflowId !== null) {
      clearDraft(base.current.workflowId, base.current.baseVersion);
    }
    dispatch(action);
  }, []);
  return { state, dispatch: send, load, dirty };
}
