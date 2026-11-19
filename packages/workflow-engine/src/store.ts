import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { GraphDefinition, NodeExecutionLog, WorkflowRunState } from "./schema.ts";

const require = createRequire(import.meta.url);

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface PausedCheckpoint {
  nodeId: string;
  message: string;
  allowStateEdit: boolean;
}

export interface PersistedWorkflowRun extends WorkflowRunState {
  graph: GraphDefinition;
  frontier: string[];
  activeNodeIds: string[];
  pausedCheckpoint: PausedCheckpoint | null;
  createdAt: string;
  updatedAt: string;
}

function openSqlite(dbPath: string): SqliteDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  let db: SqliteDb;
  const nodeMajor = Number(process.versions.node.split(".")[0] || "20");
  if (nodeMajor >= 22) {
    try {
      const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => SqliteDb };
      db = new DatabaseSync(dbPath);
    } catch {
      const BetterSqlite3 = require("better-sqlite3") as new (p: string) => SqliteDb;
      db = new BetterSqlite3(dbPath);
    }
  } else {
    const BetterSqlite3 = require("better-sqlite3") as new (p: string) => SqliteDb;
    db = new BetterSqlite3(dbPath);
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      graph_json TEXT NOT NULL,
      status TEXT NOT NULL,
      current_node_id TEXT,
      frontier_json TEXT NOT NULL,
      paused_checkpoint_json TEXT,
      step_count INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_updated ON workflow_runs(updated_at DESC);
  `);

  return db;
}

function rowToRun(row: Record<string, unknown>): PersistedWorkflowRun {
  return {
    runId: String(row.run_id),
    graphId: String(row.graph_id),
    graph: JSON.parse(String(row.graph_json)) as GraphDefinition,
    status: String(row.status) as WorkflowRunState["status"],
    currentNodeId: row.current_node_id ? String(row.current_node_id) : null,
    frontier: JSON.parse(String(row.frontier_json || "[]")) as string[],
    activeNodeIds: JSON.parse(String(row.frontier_json || "[]")) as string[],
    pausedCheckpoint: row.paused_checkpoint_json
      ? (JSON.parse(String(row.paused_checkpoint_json)) as PausedCheckpoint)
      : null,
    stepCount: Number(row.step_count ?? 0),
    data: JSON.parse(String(row.data_json || "{}")) as Record<string, unknown>,
    history: JSON.parse(String(row.history_json || "[]")) as NodeExecutionLog[],
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class WorkflowRunStore {
  private readonly db: SqliteDb;
  readonly dbPath: string;

  constructor(cwd: string, dbPath?: string) {
    this.dbPath = dbPath || join(cwd, ".pi", "workflows", "runs.sqlite");
    this.db = openSqlite(this.dbPath);
  }

  saveRun(run: PersistedWorkflowRun): void {
    const now = new Date().toISOString();
    run.updatedAt = now;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workflow_runs (
          run_id, graph_id, graph_json, status, current_node_id,
          frontier_json, paused_checkpoint_json, step_count,
          data_json, history_json, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.graphId,
        JSON.stringify(run.graph),
        run.status,
        run.currentNodeId,
        JSON.stringify(run.frontier),
        run.pausedCheckpoint ? JSON.stringify(run.pausedCheckpoint) : null,
        run.stepCount,
        JSON.stringify(run.data),
        JSON.stringify(run.history),
        run.error ?? null,
        run.createdAt,
        run.updatedAt,
      );
  }

  getRun(runId: string): PersistedWorkflowRun | null {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE run_id = ?").get(runId);
    return row ? rowToRun(row) : null;
  }

  listRuns(limit = 50): PersistedWorkflowRun[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_runs ORDER BY updated_at DESC LIMIT ?")
      .all(limit);
    return rows.map(rowToRun);
  }

  listInterruptedRuns(): PersistedWorkflowRun[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_runs WHERE status = 'running' ORDER BY created_at ASC")
      .all();
    return rows.map(rowToRun);
  }

  close(): void {
    this.db.close();
  }
}
