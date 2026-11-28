import { Input } from "@ui-sdk/react/input";
import { useEffect } from "react";
import { isNode } from "../api/guards";
import type { JsonObject, TriggerNode } from "../api/types";
import { parseRunInput } from "../run/run-input";
import { TriggerRunInput } from "../run/trigger-input";
import type { KindBodyProps } from "./kind-forms";
import { CronField, OutputHint, Row, Segmented, SourceField, ZoneField } from "./trigger-fields";
import {
  browserZone,
  defaultName,
  isSampleInput,
  renameTrigger,
  STATUS_OPTIONS,
  sampleInput,
  setTriggerField,
  switchMode,
  TRIGGER_MODES,
  type TriggerMode,
  triggerIssueView,
  triggerMode,
} from "./trigger-spec";
import { toObject, useDraft } from "./use-draft";
import { FollowerLine, NextRun, WebhookField } from "./webhook-field";

const INPUT_NOTES: Readonly<Record<TriggerMode, string>> = {
  manual: "JSON object sent as the run input.",
  cron: "A test run starts with this input.",
  webhook: "The webhook body becomes this input.",
  workflow_finished: "A test run starts with this input. It mimics the source run.",
};

function inputKeys(text: string): readonly string[] {
  const parsed = parseRunInput(text);
  return parsed.ok ? Object.keys(parsed.value) : [];
}

function TriggerForm({ node, issues, edit }: KindBodyProps & { readonly node: TriggerNode }) {
  const { draft, change, flush } = useDraft(node, (next) => edit.updateNode(node.id, next));
  const spec = draftSpec(draft, node);
  const mode = triggerMode(spec);
  const view = triggerIssueView(spec, issues);
  const disabled = !edit.editable;
  const apply = (next: TriggerNode, immediate = false) => change(toObject(next), immediate);

  const needsZone = mode === "cron" && !spec.cron_timezone && !disabled;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill the zone once when it is missing
  useEffect(() => {
    if (needsZone) apply(setTriggerField(spec, "cron_timezone", browserZone()), true);
  }, [needsZone]);

  function onMode(next: TriggerMode) {
    apply(switchMode(spec, next), true);
    if (isSampleInput(edit.runInput.text)) edit.runInput.onChange(sampleInput(next));
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur flushes the pending edit
    <div className="form" onBlur={flush}>
      <Row label="Name" error={view.fields.name}>
        <Input
          aria-label="Name"
          value={spec.name ?? ""}
          placeholder={defaultName(mode)}
          disabled={disabled}
          autoComplete="off"
          onValueChange={(next) => apply(renameTrigger(spec, next))}
        />
      </Row>
      <Row label="Mode" required error={view.fields.mode}>
        <Segmented
          label="Mode"
          value={mode}
          options={TRIGGER_MODES}
          disabled={disabled}
          onChange={onMode}
        />
      </Row>
      {mode === "cron" ? (
        <>
          <CronField
            value={spec.cron ?? ""}
            zone={spec.cron_timezone ?? browserZone()}
            disabled={disabled}
            error={view.fields.cron}
            onChange={(cron) => apply(setTriggerField(spec, "cron", cron))}
          />
          <ZoneField
            value={spec.cron_timezone ?? browserZone()}
            disabled={disabled}
            error={view.fields.cron_timezone}
            onChange={(zone) => apply(setTriggerField(spec, "cron_timezone", zone), true)}
          />
          <NextRun triggers={edit.triggers} />
        </>
      ) : null}
      {mode === "webhook" ? <WebhookField nodeId={node.id} edit={edit} /> : null}
      {mode === "workflow_finished" ? (
        <>
          <SourceField
            value={spec.source_workflow_id ?? null}
            workflows={edit.workflows}
            currentId={edit.workflowId}
            disabled={disabled}
            error={view.fields.source_workflow_id}
            onChange={(id) => apply(setTriggerField(spec, "source_workflow_id", id), true)}
          />
          <Row label="On status" error={view.fields.on_status}>
            <Segmented
              label="On status"
              value={spec.on_status ?? "succeeded"}
              options={STATUS_OPTIONS}
              disabled={disabled}
              onChange={(status) => apply({ ...spec, on_status: status }, true)}
            />
          </Row>
          <FollowerLine triggers={edit.triggers} workflows={edit.workflows} />
        </>
      ) : null}
      <TriggerRunInput input={edit.runInput} note={INPUT_NOTES[mode]} />
      <OutputHint keys={inputKeys(edit.runInput.text)} />
    </div>
  );
}

function draftSpec(draft: JsonObject, fallback: TriggerNode): TriggerNode {
  return isNode(draft) && draft.kind === "trigger" ? draft : fallback;
}

export function TriggerBody(props: KindBodyProps) {
  const { node } = props;
  return node.kind === "trigger" ? <TriggerForm {...props} node={node} /> : null;
}
