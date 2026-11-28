import { useEffect, useMemo, useState } from "react";
import { ApiError, type Issue, validateDraft, type WorkflowDraft } from "../api";
import { freshIssues, issuesFromDetail } from "../state/workflow-ops";

const VALIDATE_DELAY_MS = 400;

interface Checked {
  readonly issues: readonly Issue[];
  readonly nodes: WorkflowDraft["nodes"];
}

const NONE: Checked = { issues: [], nodes: [] };

function failureIssues(error: unknown, draft: WorkflowDraft): readonly Issue[] {
  if (error instanceof ApiError && error.issues.length > 0) return error.issues;
  const detail = error instanceof ApiError ? issuesFromDetail(error.body, draft.nodes) : [];
  if (detail.length > 0) return detail;
  const message = error instanceof Error ? error.message : String(error);
  return [{ code: "validate_failed", message: `Validation failed: ${message}`, node: null }];
}

export function useValidation(
  workflowId: string | null,
  draft: WorkflowDraft,
  enabled: boolean,
): readonly Issue[] {
  const [checked, setChecked] = useState<Checked>(NONE);

  useEffect(() => {
    if (workflowId === null || !enabled) {
      setChecked(NONE);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      validateDraft(draft, workflowId, controller.signal).then(
        (response) => {
          if (!controller.signal.aborted)
            setChecked({ issues: response.issues, nodes: draft.nodes });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setChecked({ issues: failureIssues(error, draft), nodes: draft.nodes });
        },
      );
    }, VALIDATE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workflowId, draft, enabled]);

  return useMemo(
    () => freshIssues(checked.issues, checked.nodes, draft.nodes),
    [checked, draft.nodes],
  );
}
