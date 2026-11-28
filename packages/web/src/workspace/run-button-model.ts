import { availableActions } from "../run/run-state";
import type { RunStatus } from "../types";

export type RunButtonKind = "run" | "cancel" | "edit";

export interface RunButtonInput {
  readonly runMode: boolean;
  readonly status: RunStatus | null;
  readonly latest: number | null;
  readonly dirty: boolean;
  readonly inputError: string | null;
  readonly starting: boolean;
  readonly busy: boolean;
}

export interface RunButtonView {
  readonly kind: RunButtonKind;
  readonly label: string;
  readonly tip: string | null;
  readonly disabled: boolean;
}

export const SAVE_FIRST_TIP = "Save first";

export function runButtonView(input: RunButtonInput): RunButtonView {
  const { runMode, status, latest, dirty, inputError, starting, busy } = input;
  if (runMode) {
    if (availableActions(status).cancel) {
      return { kind: "cancel", label: "Cancel", tip: null, disabled: busy };
    }
    return { kind: "edit", label: "Edit", tip: null, disabled: false };
  }
  if (latest === null) return { kind: "run", label: "Run", tip: SAVE_FIRST_TIP, disabled: true };
  if (inputError !== null) return { kind: "run", label: "Run", tip: inputError, disabled: true };
  const tip = dirty ? `Runs v${latest}. Unsaved edits are not included.` : null;
  return { kind: "run", label: "Run", tip, disabled: starting };
}
