import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const getWorkDir = (ctx: ExtensionContext): string => {
    const cwd = ctx.cwd || process.cwd();
    const workDir = join(cwd, ".pi", "work");
    mkdirSync(workDir, { recursive: true });
    return workDir;
  };

  pi.on("session_before_compact", async (event, ctx) => {
    try {
      const workDir = getWorkDir(ctx);
      const checkpointFile = join(workDir, "checkpoint_last.json");
      const stateFile = join(workDir, "state.json");

      let existingState: Record<string, unknown> = {};
      if (existsSync(stateFile)) {
        try {
          existingState = JSON.parse(readFileSync(stateFile, "utf-8"));
        } catch {
          // ignore malformed state
        }
      }

      // Extract user messages and recent tool activity
      const entries = (ctx.sessionManager?.getEntries?.() as Array<Record<string, unknown>>) || [];
      const userMessages = entries.filter((e) => e.type === "message" && (e.message as Record<string, unknown>)?.role === "user");
      const lastUserMsg = userMessages[userMessages.length - 1];
      const rawContent = (lastUserMsg?.message as Record<string, unknown>)?.content;
      const lastPrompt = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent || "");

      const recentToolCalls: Array<{ tool: string; args?: unknown }> = [];
      for (let i = entries.length - 1; i >= 0 && recentToolCalls.length < 6; i--) {
        const e = entries[i];
        const msg = e.message as Record<string, unknown> | undefined;
        if (e.type === "message" && msg?.content && Array.isArray(msg.content)) {
          for (const p of msg.content) {
            if (p.type === "toolCall") {
              recentToolCalls.push({ tool: p.name, args: p.arguments });
            }
          }
        }
      }

      const checkpointData = {
        saved_at: new Date().toISOString(),
        event: "session_before_compact",
        reason: event.reason || "auto",
        sessionId: ctx.sessionManager?.getSessionId?.(),
        last_user_prompt: lastPrompt.slice(0, 1500),
        active_state: existingState,
        recent_tool_calls: recentToolCalls,
        instructions_for_agent:
          "Compaction triggered. Inspect this checkpoint and .pi/work/state.json to resume your exact task progress without repeating completed items."
      };

      writeFileSync(checkpointFile, JSON.stringify(checkpointData, null, 2), "utf-8");
      if (ctx.hasUI && ctx.ui?.notify) {
        ctx.ui.notify("💾 Pre-compaction state saved to .pi/work/checkpoint_last.json");
      }
    } catch (err) {
      console.error("[Checkpoint Extension] Failed to save pre-compaction checkpoint:", err);
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    try {
      const workDir = getWorkDir(ctx);
      const checkpointFile = join(workDir, "checkpoint_last.json");
      if (existsSync(checkpointFile)) {
        const raw = readFileSync(checkpointFile, "utf-8");
        const data = JSON.parse(raw);
        const entry = event.compactionEntry as { summary?: string } | undefined;
        data.compaction_summary = entry?.summary || "";
        data.compacted_at = new Date().toISOString();
        writeFileSync(checkpointFile, JSON.stringify(data, null, 2), "utf-8");
      }
    } catch (err) {
      console.error("[Checkpoint Extension] Failed to update compaction summary:", err);
    }
  });
}
