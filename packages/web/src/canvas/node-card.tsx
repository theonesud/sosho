import type { PointerEvent as ReactPointerEvent } from "react";
import { isJsonValue } from "../api/guards";
import type { Issue, JsonValue, Node } from "../api/types";
import { Icon } from "../components/icon";
import { IconTip } from "../components/icon-tip";
import { JsonViewer } from "../components/json-viewer";
import { cssVars } from "../css-vars";
import { IssueList } from "../form/issue-list";
import { kindFormOf, nodeLabel } from "../form/kind-forms";
import { NodeForm } from "../form/node-form";
import { kindMeta } from "../meta";
import { nodeStatusMeta } from "../run/node-status";
import { RunNodeBody, type RunNodeInfo } from "../run/run-node-body";
import type { NodeStatus } from "../run/run-state";
import type { Rect } from "./camera";
import type { EditApi } from "./edit-api";
import { OutputHandle } from "./output-handle";

interface NodeCardProps {
  readonly node: Node;
  readonly rect: Rect;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly status?: NodeStatus | undefined;
  readonly run?: RunNodeInfo | undefined;
  readonly sizeRef: (element: HTMLElement | null) => void;
  readonly issues?: readonly Issue[] | undefined;
  readonly edit: EditApi;
  readonly taken: ReadonlySet<string>;
  readonly connectTarget: boolean;
  readonly onHandleDown: (event: ReactPointerEvent, onClick: () => void) => void;
}

function nodeJson(node: Node): JsonValue | null {
  const parsed: unknown = JSON.parse(JSON.stringify(node));
  return isJsonValue(parsed) ? parsed : null;
}

function StatusSlot({ status }: { readonly status: NodeStatus | undefined }) {
  if (!status) return <span className="cv-status" aria-hidden="true" />;
  return (
    <span
      className="cv-status"
      data-status={status}
      role="img"
      aria-label={nodeStatusMeta(status).label}
    >
      <Icon name={nodeStatusMeta(status).icon} size={14} />
    </span>
  );
}

function Placeholder({ node }: { readonly node: Node }) {
  const json = nodeJson(node);
  return json === null ? null : <JsonViewer value={json} label={`${node.id} settings`} />;
}

function NodeBody({
  node,
  issues,
  edit,
  taken,
}: Pick<NodeCardProps, "node" | "issues" | "edit" | "taken">) {
  const form = kindFormOf(node.kind);
  if (form) return <form.Body node={node} issues={issues ?? []} edit={edit} />;
  const schema = edit.catalog?.kinds.find((entry) => entry.kind === node.kind)?.json_schema;
  return (
    <>
      <IssueList messages={(issues ?? []).map((issue) => issue.message)} />
      {schema ? (
        <NodeForm
          node={node}
          schema={schema}
          catalog={edit.catalog}
          taken={taken}
          disabled={!edit.editable}
          onChange={(next) => edit.updateNode(node.id, next)}
        />
      ) : (
        <Placeholder node={node} />
      )}
    </>
  );
}

function invalidMessages(node: Node, issues: readonly Issue[] | undefined, live: boolean) {
  const form = kindFormOf(node.kind);
  if (form && live) return form.messages(node, issues ?? []);
  return (issues ?? []).map((issue) => issue.message);
}

export function NodeCard(props: NodeCardProps) {
  const { node, rect, expanded, selected, status, run, sizeRef, issues, edit, connectTarget } =
    props;
  const { onHandleDown } = props;
  const kind = kindMeta[node.kind];
  const messages = invalidMessages(node, issues, edit.editable && !run);
  const invalid = messages.length > 0;
  const inline = kindFormOf(node.kind) !== undefined && expanded;
  return (
    <div
      ref={sizeRef}
      className="cv-node"
      data-node-id={node.id}
      data-kind={node.kind}
      data-status={status}
      data-expanded={expanded ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-invalid={invalid && !inline ? "" : undefined}
      data-connect-target={connectTarget ? "" : undefined}
      title={expanded ? undefined : messages.join("\n")}
      style={cssVars({ "--x": `${rect.x}px`, "--y": `${rect.y}px` })}
    >
      <div className="cv-node-top">
        <button type="button" className="cv-node-head" aria-expanded={expanded}>
          <span className="cv-node-chip">
            <Icon name={kind.icon} size={16} className="cv-node-icon" />
          </span>
          <span className="cv-node-name">{nodeLabel(node)}</span>
          {invalid && !status ? (
            <span className="cv-flag" role="img" aria-label="Has validation issues">
              <Icon name="warning" size={14} />
            </span>
          ) : (
            <StatusSlot status={status} />
          )}
        </button>
        {expanded && edit.editable && !run ? (
          <span className="cv-node-actions" data-no-pan>
            <IconTip
              icon="copy"
              label="Copy node"
              shortcut="mod+c"
              onClick={() => void edit.copy()}
            />
            <IconTip
              icon="duplicate"
              label="Duplicate node"
              shortcut="mod+d"
              onClick={edit.duplicate}
            />
            <IconTip
              icon="trash"
              label="Delete node"
              shortcut="delete"
              onClick={() => edit.deleteNode(node.id)}
            />
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div className="cv-node-body" data-no-pan>
          {run ? (
            <RunNodeBody node={node} info={run} />
          ) : (
            <NodeBody node={node} issues={issues} edit={edit} taken={props.taken} />
          )}
        </div>
      ) : null}
      {edit.editable && edit.catalog ? (
        <OutputHandle
          node={nodeLabel(node)}
          kinds={edit.catalog.kinds}
          hasTrigger={edit.hasTrigger}
          onPointerDown={onHandleDown}
          sourceKind={node.kind}
          onAdd={(kindName) => edit.addAfter(node.id, kindName)}
        />
      ) : null}
    </div>
  );
}
