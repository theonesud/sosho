import { describe, expect, it } from "vitest";
import { type RunButtonInput, runButtonView } from "./run-button-model";

const base: RunButtonInput = {
  runMode: false,
  status: null,
  latest: 3,
  dirty: false,
  inputError: null,
  starting: false,
  busy: false,
};

describe("run button view", () => {
  it("runs the latest saved version in edit mode", () => {
    expect(runButtonView(base)).toEqual({ kind: "run", label: "Run", tip: null, disabled: false });
    expect(runButtonView({ ...base, dirty: true }).tip).toBe(
      "Runs v3. Unsaved edits are not included.",
    );
    expect(runButtonView({ ...base, starting: true }).disabled).toBe(true);
  });

  it("is disabled until a version is saved or when the input is bad", () => {
    expect(runButtonView({ ...base, latest: null })).toMatchObject({
      disabled: true,
      tip: "Save first",
    });
    expect(runButtonView({ ...base, inputError: "Bad JSON" })).toMatchObject({
      disabled: true,
      tip: "Bad JSON",
    });
  });

  it("cancels an active run and offers edit for an ended run", () => {
    for (const status of ["pending", "running", "waiting"] as const) {
      expect(runButtonView({ ...base, runMode: true, status }).kind).toBe("cancel");
    }
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
      expect(runButtonView({ ...base, runMode: true, status })).toMatchObject({
        kind: "edit",
        label: "Edit",
        disabled: false,
      });
    }
    expect(runButtonView({ ...base, runMode: true, status: "running", busy: true }).disabled).toBe(
      true,
    );
  });
});
