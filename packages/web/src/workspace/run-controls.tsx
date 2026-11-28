import { Button } from "@ui-sdk/react/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { useEffect, useState } from "react";
import { Icon } from "../components/icon";
import type { IconName } from "../components/icon-paths";
import { IconTip } from "../components/icon-tip";
import { RunStatusBadge } from "../components/run-status-badge";
import { isTerminal, type RunAvailability } from "../run/run-state";
import type { RunStatus } from "../types";
import type { RunButtonKind, RunButtonView } from "./run-button-model";

export interface RunButtonProps {
  readonly view: RunButtonView;
  readonly starting: boolean;
  readonly onClick: () => void;
}

const FACE: Readonly<Record<RunButtonKind, { readonly icon: IconName; readonly variant: string }>> =
  {
    run: { icon: "run", variant: "primary" },
    cancel: { icon: "x", variant: "danger" },
    edit: { icon: "pencil", variant: "secondary" },
  };

export function RunButton({ view, starting, onClick }: RunButtonProps) {
  const { kind, label, tip, disabled } = view;
  const face = FACE[kind];
  const button = (
    <Button
      data-variant={face.variant}
      data-kind={kind}
      className="run-btn"
      disabled={disabled}
      onClick={onClick}
    >
      <span key={kind} className="run-btn-face">
        {starting ? <span className="spinner" aria-hidden="true" /> : <Icon name={face.icon} />}
        {label}
      </span>
    </Button>
  );
  if (tip === null) return button;
  if (!disabled) {
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="run-btn-wrap" />}>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

export interface RunBarProps {
  readonly status: RunStatus | null;
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
  readonly actions: RunAvailability;
  readonly forkNode: string | null;
  readonly busy: boolean;
  readonly onResume: () => void;
  readonly onFork: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Elapsed({
  status,
  createdAt,
  updatedAt,
}: Pick<RunBarProps, "status" | "createdAt" | "updatedAt">) {
  const live = !isTerminal(status);
  const now = useNow(live);
  if (createdAt === null) return null;
  const end = live ? now : (updatedAt ?? createdAt);
  return (
    <span className="hud-elapsed mono muted" role="timer" aria-label="Elapsed time">
      {formatElapsed(end - createdAt)}
    </span>
  );
}

export function RunBar(props: RunBarProps) {
  const { status, actions, busy } = props;
  return (
    <>
      {status ? <RunStatusBadge status={status} /> : <span className="badge">Run mode</span>}
      <Elapsed status={status} createdAt={props.createdAt} updatedAt={props.updatedAt} />
      {actions.resume ? (
        <IconTip icon="refresh" label="Resume" disabled={busy} onClick={props.onResume} />
      ) : null}
      {actions.fork ? (
        <IconTip
          icon="branch"
          label={props.forkNode === null ? "No node to fork from" : `Fork from ${props.forkNode}`}
          disabled={busy || props.forkNode === null}
          onClick={props.onFork}
        />
      ) : null}
    </>
  );
}
