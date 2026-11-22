import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// This file sits four levels below the repository root: .pi/extensions/guard/src.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HOOK_TIMEOUT_MS = 10_000;

function runHook(script: string, payload: string) {
  return spawnSync(join(ROOT, "bin", script), {
    input: payload,
    encoding: "utf-8",
    timeout: HOOK_TIMEOUT_MS,
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    const payload = JSON.stringify({ tool_name: event.toolName, tool_input: event.input });
    const result = runHook("agent-guard.sh", payload);
    if (result.status === 2) {
      return { block: true, reason: result.stderr.trim() };
    }
    return undefined;
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "write" && event.toolName !== "edit") {
      return undefined;
    }
    const payload = JSON.stringify({ tool_name: event.toolName, tool_input: event.input });
    // Post-edit steps never block the agent. Their failures are ignored.
    runHook("agent-post-edit.sh", payload);
    runHook("agent-format.sh", payload);
    return undefined;
  });
}
