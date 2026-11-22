import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK_TIMEOUT_MS = 10_000;
const EDIT_TOOLS = new Set(["edit", "write"]);

function runHook(script: string, payload: string) {
  return spawnSync(join(ROOT, "bin", script), {
    input: payload,
    encoding: "utf-8",
    timeout: HOOK_TIMEOUT_MS,
  });
}

export const GuardPlugin: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    const payload = JSON.stringify({ tool_name: input.tool, tool_input: output.args });
    const result = runHook("agent-guard.sh", payload);
    if (result.status === 2) {
      throw new Error(result.stderr.trim());
    }
  },
  "tool.execute.after": async (input) => {
    if (!EDIT_TOOLS.has(input.tool)) {
      return;
    }
    const payload = JSON.stringify({ tool_name: input.tool, tool_input: input.args });
    runHook("agent-post-edit.sh", payload);
    runHook("agent-format.sh", payload);
  },
});
