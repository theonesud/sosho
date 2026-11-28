import { Button } from "@ui-sdk/react/button";
import { Icon } from "../components/icon";
import { NameField } from "./hud-name";
import { HudTools, type HudToolsProps } from "./hud-tools";
import { RunBar, type RunBarProps, RunButton, type RunButtonProps } from "./run-controls";

export interface HudProps {
  readonly name: string;
  readonly version: number | null;
  readonly dirty: boolean;
  readonly runMode: boolean;
  readonly saving: boolean;
  readonly canSave: boolean;
  readonly saveLabel: string;
  readonly issues: readonly string[];
  readonly onRename: (name: string) => Promise<string | null>;
  readonly onSave: () => void;
  readonly runButton: RunButtonProps;
  readonly runBar: RunBarProps;
  readonly tools: Omit<HudToolsProps, "runMode">;
}

function WorkflowIssues({ messages }: { readonly messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="hud-issues" aria-label="Workflow issues">
      {messages.map((message) => (
        <li key={message}>
          <Icon name="warning" size={14} />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}

export function Hud(props: HudProps) {
  const { dirty, runMode, saving, canSave, saveLabel } = props;
  return (
    <div className="hud-wrap">
      <div className="hud" role="toolbar" aria-label="Workflow">
        <NameField name={props.name} disabled={runMode} onRename={props.onRename} />
        {props.version === null ? null : (
          <span className="hud-version" title="Opened version">
            v{props.version}
          </span>
        )}
        {dirty ? (
          <span
            className="hud-dirty"
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          />
        ) : null}
        {runMode ? <RunBar {...props.runBar} /> : null}
        <HudTools runMode={runMode} {...props.tools} />
        <Button data-variant="secondary" onClick={props.onSave} disabled={!canSave}>
          {saving ? <span className="spinner" aria-hidden="true" /> : null}
          {saveLabel}
        </Button>
        <RunButton {...props.runButton} />
      </div>
      <WorkflowIssues messages={props.issues} />
    </div>
  );
}
