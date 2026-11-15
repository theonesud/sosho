import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface TaskPlanParams {
  title: string;
  goal: string;
  items: string[];
}

export interface TaskUpdateParams {
  id?: string;
  status?: "pending" | "in_progress" | "done" | "failed";
  result?: string;
  add_items?: string[];
  current_step?: string;
}

export interface TaskStatusParams {
  filter?: "all" | "pending";
}

export interface TaskFinishParams {
  summary: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: string;
}

export interface TaskHistoryEntry {
  title: string;
  goal: string;
  completed_at: string;
  summary: string;
  total: number;
  completed: number;
  failed: number;
}

export interface CompactionContext {
  last_compacted_at: string;
  reason: string;
  last_user_prompt?: string;
  recent_tool_calls?: Array<{ tool: string; args?: unknown }>;
  compaction_summary?: string;
}

export interface SessionState {
  session_id: string;
  status: "idle" | "running" | "completed" | "interrupted";
  active_task: {
    title: string;
    goal: string;
    current_step?: string;
  } | null;
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  tasks: TaskItem[];
  history: TaskHistoryEntry[];
  compaction_context?: CompactionContext;
  updated_at: string;
}

export interface SessionPaths {
  sessionId: string;
  baseDir: string;
  ephemeralDir: string;
  permanentDir: string;
  statePath: string;
}

export function getSessionPaths(ctx: ExtensionContext): SessionPaths {
  const cwd = ctx.cwd || process.cwd();
  const rawSessionId = ctx.sessionManager?.getSessionId?.() || "default";
  const sessionId = rawSessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const baseDir = join(cwd, ".pi", "scratchpad", sessionId);
  const ephemeralDir = join(baseDir, "ephemeral");
  const permanentDir = join(baseDir, "permanent");
  const statePath = join(ephemeralDir, "state.json");

  mkdirSync(ephemeralDir, { recursive: true });
  mkdirSync(permanentDir, { recursive: true });

  // Export environment variables so child bash/python scripts know the active session's permanent workspace
  process.env.SOSHO_SESSION_ID = sessionId;
  process.env.SOSHO_SCRATCHPAD_DIR = baseDir;
  process.env.SOSHO_EPHEMERAL_DIR = ephemeralDir;
  process.env.SOSHO_PERMANENT_DIR = permanentDir;
  process.env.SOSHO_SCRATCH_DIR = permanentDir;
  process.env.DOKO_SCRATCH_DIR = permanentDir;
  process.env.SOSHO_RESEARCH_DIR = join(permanentDir, "research");
  process.env.SOSHO_PLOTS_DIR = join(permanentDir, "plots");
  process.env.SOSHO_SECURITY_DIR = join(permanentDir, "security");
  process.env.SOSHO_TRANSCRIPTS_DIR = join(permanentDir, "transcripts");

  return { sessionId, baseDir, ephemeralDir, permanentDir, statePath };
}

export class StateManager {
  private readonly statePath: string;
  private readonly sessionId: string;

  constructor(statePath: string, sessionId: string) {
    this.statePath = statePath;
    this.sessionId = sessionId;
  }

  private createDefaultState(): SessionState {
    return {
      session_id: this.sessionId,
      status: "idle",
      active_task: null,
      progress: {
        total: 0,
        completed: 0,
        failed: 0,
      },
      tasks: [],
      history: [],
      updated_at: new Date().toISOString(),
    };
  }

  read(): SessionState {
    if (!existsSync(this.statePath)) {
      const initial = this.createDefaultState();
      this.writeAtomic(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as Partial<SessionState>;
      return {
        session_id: parsed.session_id || this.sessionId,
        status: parsed.status || "idle",
        active_task: parsed.active_task ?? null,
        progress: parsed.progress || { total: 0, completed: 0, failed: 0 },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        compaction_context: parsed.compaction_context,
        updated_at: parsed.updated_at || new Date().toISOString(),
      };
    } catch {
      const fallback = this.createDefaultState();
      this.writeAtomic(fallback);
      return fallback;
    }
  }

  private writeAtomic(state: SessionState): void {
    const tempPath = `${this.statePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tempPath, this.statePath);
  }

  mutate(updater: (state: SessionState) => void): SessionState {
    const state = this.read();
    updater(state);
    state.session_id = this.sessionId;
    state.updated_at = new Date().toISOString();
    state.progress = {
      total: state.tasks.length,
      completed: state.tasks.filter((t) => t.status === "done").length,
      failed: state.tasks.filter((t) => t.status === "failed").length,
    };
    this.writeAtomic(state);
    return state;
  }
}

function getStateManager(ctx: ExtensionContext): { sm: StateManager; paths: SessionPaths } {
  const paths = getSessionPaths(ctx);
  return { sm: new StateManager(paths.statePath, paths.sessionId), paths };
}

function formatStateSummary(state: SessionState, paths: SessionPaths): string {
  const lines: string[] = [
    `Session ID: ${state.session_id}`,
    `Permanent Workspace: .pi/scratchpad/${state.session_id}/permanent`,
    `Status: ${state.status}`,
  ];

  if (state.active_task) {
    lines.push(`Active Task: "${state.active_task.title}"`);
    lines.push(`Goal: ${state.active_task.goal}`);
    lines.push(
      `Progress: ${state.progress.completed}/${state.progress.total} completed (${state.progress.failed} failed)`,
    );
    if (state.active_task.current_step) {
      lines.push(`Current Step: ${state.active_task.current_step}`);
    }
    lines.push("");
    lines.push("Tasks:");
    for (const t of state.tasks) {
      const icon =
        t.status === "done"
          ? "[x]"
          : t.status === "in_progress"
            ? "[>]"
            : t.status === "failed"
              ? "[!]"
              : "[ ]";
      lines.push(`  ${icon} ${t.id}: ${t.title}${t.result ? ` — ${t.result}` : ""}`);
    }
  } else {
    lines.push("Active Task: None (idle)");
  }

  if (state.history.length > 0) {
    lines.push("");
    lines.push(`Completed Tasks in Session (${state.history.length}):`);
    for (const h of state.history) {
      lines.push(`  - "${h.title}" (${h.completed}/${h.total} done) — ${h.summary}`);
    }
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  let latestStatePath: string | null = null;
  let latestSessionId: string | null = null;

  const markInterruptedOnSignal = () => {
    if (!latestStatePath || !latestSessionId || !existsSync(latestStatePath)) return;
    try {
      const sm = new StateManager(latestStatePath, latestSessionId);
      const current = sm.read();
      if (current.status === "running") {
        sm.mutate((s) => {
          s.status = "interrupted";
        });
      }
    } catch {
      // Ignore errors during signal exit
    }
  };

  process.once("SIGINT", markInterruptedOnSignal);
  process.once("SIGTERM", markInterruptedOnSignal);

  // ---------------------------------------------------------------------------
  // 1. Block manual read/write/edit to ephemeral/state.json
  // ---------------------------------------------------------------------------
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "read") {
      return undefined;
    }
    const targetPath = String((event.input as Record<string, unknown>)?.path || "");
    if (targetPath.includes("ephemeral/state.json") || targetPath.endsWith("/state.json")) {
      if (ctx.hasUI && ctx.ui?.notify) {
        ctx.ui.notify("Blocked direct file access to state.json. Using task_* tools instead.", "warning");
      }
      return {
        block: true,
        reason:
          "Direct file access to state.json is forbidden. Use the dedicated CRUD tools (`task_plan`, `task_update`, `task_status`, `task_finish`) to inspect or mutate task state.",
      };
    }
    return undefined;
  });

  // ---------------------------------------------------------------------------
  // 2. Lifecycle: Session Start & Interruption Detection
  // ---------------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    try {
      const { sm, paths } = getStateManager(ctx);
      latestStatePath = paths.statePath;
      latestSessionId = paths.sessionId;

      const state = sm.read();
      if (state.status === "running") {
        sm.mutate((s) => {
          s.status = "interrupted";
        });
        if (ctx.hasUI && ctx.ui?.notify) {
          ctx.ui.notify(
            `⚠️ Interrupted task detected: "${state.active_task?.title || "Unnamed"}". Use task_status to resume.`,
            "warning",
          );
        }
      }
    } catch (err) {
      console.error("[Scratchpad Extension] Failed to initialize session state:", err);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Inject Active Session Scratchpad Paths & Interruption Notice Before Agent Turn
  // ---------------------------------------------------------------------------
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const { sm, paths } = getStateManager(ctx);
      latestStatePath = paths.statePath;
      latestSessionId = paths.sessionId;

      const state = sm.read();
      const relPermanent = `.pi/scratchpad/${paths.sessionId}/permanent`;

      const addonLines: string[] = [
        "",
        "## Active Session Scratchpad",
        `- **Session ID**: \`${paths.sessionId}\``,
        `- **Permanent Workspace**: \`${relPermanent}/\` (use this directory for all scripts, raw web dumps, research, plots, and intermediate files)`,
        `- **Task State Management**: Managed strictly via CRUD tools (\`task_plan\`, \`task_update\`, \`task_status\`, \`task_finish\`). Never read or edit \`state.json\` directly. Only create a task plan for multi-step (2+) or batch tasks; do not use task tools for trivial single-turn questions.`,
      ];

      if (state.status === "interrupted" && state.active_task) {
        addonLines.push(
          `- **INTERRUPTION RECOVERY**: Previous run was interrupted during task "${state.active_task.title}" (${state.progress.completed}/${state.progress.total} completed). Call \`task_status\` before continuing if resuming this work.`,
        );
      } else if (state.status === "running" && state.active_task) {
        addonLines.push(
          `- **ACTIVE TASK**: "${state.active_task.title}" (${state.progress.completed}/${state.progress.total} completed, current step: ${state.active_task.current_step || "in progress"}).`,
        );
      }

      return {
        systemPrompt: `${event.systemPrompt}\n${addonLines.join("\n")}\n`,
      };
    } catch {
      return undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Lifecycle: Session Compaction (Stored directly in state.json)
  // ---------------------------------------------------------------------------
  pi.on("session_before_compact", async (event, ctx) => {
    try {
      const { sm, paths } = getStateManager(ctx);
      const entries = (ctx.sessionManager?.getEntries?.() as unknown as Array<Record<string, unknown>>) || [];
      const userMessages = entries.filter(
        (e) => e.type === "message" && (e.message as Record<string, unknown>)?.role === "user",
      );
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

      sm.mutate((s) => {
        s.compaction_context = {
          last_compacted_at: new Date().toISOString(),
          reason: event.reason || "auto",
          last_user_prompt: lastPrompt.slice(0, 1000),
          recent_tool_calls: recentToolCalls,
        };
      });

      if (ctx.hasUI && ctx.ui?.notify) {
        ctx.ui.notify(`💾 Pre-compaction state saved to .pi/scratchpad/${paths.sessionId}/ephemeral/state.json`);
      }
    } catch (err) {
      console.error("[Scratchpad Extension] Failed to save pre-compaction state:", err);
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    try {
      const { sm } = getStateManager(ctx);
      const entry = event.compactionEntry as { summary?: string } | undefined;
      sm.mutate((s) => {
        if (!s.compaction_context) {
          s.compaction_context = {
            last_compacted_at: new Date().toISOString(),
            reason: event.reason || "auto",
          };
        }
        s.compaction_context.compaction_summary = entry?.summary || "";
      });
    } catch (err) {
      console.error("[Scratchpad Extension] Failed to record compaction summary:", err);
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Lifecycle: Session Shutdown
  // ---------------------------------------------------------------------------
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      const { sm } = getStateManager(ctx);
      const state = sm.read();
      if (state.status === "running") {
        sm.mutate((s) => {
          s.status = "interrupted";
        });
      }
    } catch {
      // Ignore shutdown errors
    }
  });

  // ---------------------------------------------------------------------------
  // 6. CRUD Tool: task_plan
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "task_plan",
    label: "Task Plan",
    description:
      "Initialize a new multi-step task plan for the current session. If a previous task was active, archives it to history first. Do not use for trivial 1-step questions.",
    promptSnippet: "task_plan: Initialize a multi-step task queue in session state",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the task (e.g., 'Extract 2026 Twitter Likes')" },
        goal: { type: "string", description: "Clear objective and completion criteria" },
        items: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of discrete task items/steps to execute",
          minItems: 1,
        },
      },
      required: ["title", "goal", "items"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as TaskPlanParams;
      const { sm, paths } = getStateManager(ctx);
      const updated = sm.mutate((s) => {
        // If there was an unfinished task, archive it to history before starting the new one
        if (s.active_task && s.tasks.length > 0) {
          s.history.push({
            title: s.active_task.title,
            goal: s.active_task.goal,
            completed_at: new Date().toISOString(),
            summary: `Superseded by "${params.title}" (${s.progress.completed}/${s.progress.total} completed)`,
            total: s.progress.total,
            completed: s.progress.completed,
            failed: s.progress.failed,
          });
        }

        s.status = "running";
        s.active_task = {
          title: params.title,
          goal: params.goal,
          current_step: `[t-1] ${params.items[0]}`,
        };
        s.tasks = params.items.map((title, idx) => ({
          id: `t-${idx + 1}`,
          title,
          status: idx === 0 ? "in_progress" : "pending",
        }));
      });

      return {
        content: [
          {
            type: "text",
            text: formatStateSummary(updated, paths),
          },
        ],
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 7. CRUD Tool: task_update
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "task_update",
    label: "Task Update",
    description:
      "Update the status or result of one or more tasks in the active plan, or append new discovered items to the queue.",
    promptSnippet: "task_update: Update task item status (in_progress, done, failed) or add items",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to update (e.g., 't-1')" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "failed"],
          description: "New status for the task item",
        },
        result: { type: "string", description: "Concise result note, file path, or failure reason" },
        add_items: {
          type: "array",
          items: { type: "string" },
          description: "Optional new task items to append to the queue",
        },
        current_step: { type: "string", description: "Optional override for current active step description" },
      },
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as TaskUpdateParams;
      const { sm } = getStateManager(ctx);
      const updated = sm.mutate((s) => {
        if (s.status === "interrupted" || s.status === "idle") {
          if (s.active_task) s.status = "running";
        }

        if (params.id) {
          const item = s.tasks.find((t) => t.id === params.id);
          if (item) {
            if (params.status) item.status = params.status;
            if (params.result !== undefined) item.result = params.result;
          }
        }

        if (params.add_items && params.add_items.length > 0) {
          const startIdx = s.tasks.length + 1;
          for (let i = 0; i < params.add_items.length; i++) {
            s.tasks.push({
              id: `t-${startIdx + i}`,
              title: params.add_items[i],
              status: "pending",
            });
          }
        }

        // Auto-advance next pending item to in_progress if none is currently in_progress
        const hasInProgress = s.tasks.some((t) => t.status === "in_progress");
        if (!hasInProgress) {
          const nextPending = s.tasks.find((t) => t.status === "pending");
          if (nextPending) {
            nextPending.status = "in_progress";
            if (s.active_task) {
              s.active_task.current_step = `[${nextPending.id}] ${nextPending.title}`;
            }
          } else if (s.active_task) {
            s.active_task.current_step = "All items processed — ready for task_finish";
          }
        } else if (params.current_step && s.active_task) {
          s.active_task.current_step = params.current_step;
        } else if (s.active_task) {
          const currentActive = s.tasks.find((t) => t.status === "in_progress");
          if (currentActive) {
            s.active_task.current_step = `[${currentActive.id}] ${currentActive.title}`;
          }
        }
      });

      const nextActive = updated.tasks.find((t) => t.status === "in_progress");
      const summaryLine = `Updated state: ${updated.progress.completed}/${updated.progress.total} done (${updated.progress.failed} failed). ${
        nextActive
          ? `Next in_progress: [${nextActive.id}] ${nextActive.title}`
          : "No pending items remaining. Call task_finish when verified."
      }`;

      return {
        content: [{ type: "text", text: summaryLine }],
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 8. CRUD Tool: task_status
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "task_status",
    label: "Task Status",
    description:
      "Read the current session task state, progress counts, active/pending steps, and session task history. Call this after context compaction or session resume.",
    promptSnippet: "task_status: Inspect active task progress, pending items, and session history",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "pending"],
          description: "Filter tasks shown (all or pending)",
        },
      },
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = (rawParams || {}) as TaskStatusParams;
      const { sm, paths } = getStateManager(ctx);
      const state = sm.read();
      if (params.filter === "pending" && state.active_task) {
        const filtered: SessionState = {
          ...state,
          tasks: state.tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
        };
        return {
          content: [{ type: "text", text: formatStateSummary(filtered, paths) }],
        };
      }
      return {
        content: [{ type: "text", text: formatStateSummary(state, paths) }],
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 9. CRUD Tool: task_finish
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: "task_finish",
    label: "Task Finish",
    description:
      "Complete the active task plan, archive it to the session history, and reset the active queue so the session is clean for any subsequent task.",
    promptSnippet: "task_finish: Archive completed task plan and reset active queue to idle",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Final verification summary and output artifact paths produced",
        },
      },
      required: ["summary"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as TaskFinishParams;
      const { sm } = getStateManager(ctx);
      const updated = sm.mutate((s) => {
        const title = s.active_task?.title || "Completed Task";
        const goal = s.active_task?.goal || "";
        const completedCount = s.tasks.filter((t) => t.status === "done").length;
        const failedCount = s.tasks.filter((t) => t.status === "failed").length;

        s.history.push({
          title,
          goal,
          completed_at: new Date().toISOString(),
          summary: params.summary,
          total: s.tasks.length,
          completed: completedCount,
          failed: failedCount,
        });

        s.status = "idle";
        s.active_task = null;
        s.tasks = [];
      });

      const lastHistory = updated.history[updated.history.length - 1];
      return {
        content: [
          {
            type: "text",
            text: `Task "${lastHistory.title}" marked completed and archived to session history (${lastHistory.completed}/${lastHistory.total} done). Active queue is now clean and idle.`,
          },
        ],
      };
    },
  });
}
