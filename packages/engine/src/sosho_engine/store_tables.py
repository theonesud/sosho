from pydantic import BaseModel
from sqlalchemy import (
    BigInteger,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
)

METADATA = MetaData()
WORKFLOWS = Table(
    "engine_workflows",
    METADATA,
    Column("id", String(64), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text),
    Column("created_at", String(40), nullable=False),
)
VERSIONS = Table(
    "engine_workflow_versions",
    METADATA,
    Column("workflow_id", String(64), ForeignKey("engine_workflows.id"), primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("spec", Text, nullable=False),
    Column("created_at", String(40), nullable=False),
)
TRIGGERS = Table(
    "engine_triggers",
    METADATA,
    Column("workflow_id", String(64), primary_key=True),
    Column("node_id", String(64), primary_key=True),
    Column("version", Integer, nullable=False),
    Column("mode", String(32), nullable=False),
    Column("ref", String(300)),
)
HOOK_TOKENS = Table(
    "engine_webhook_tokens",
    METADATA,
    Column("workflow_id", String(64), primary_key=True),
    Column("node_id", String(64), primary_key=True),
    Column("token", String(100), nullable=False),
)
REPLIES = Table(
    "engine_replies",
    METADATA,
    Column("run_id", String(300), primary_key=True),
)
RUNS = Table(
    "engine_runs",
    METADATA,
    Column("run_id", String(300), primary_key=True),
    Column("workflow_id", String(64), nullable=False),
    Column("created_at", BigInteger, nullable=False),
    Index("engine_runs_by_workflow", "workflow_id", "created_at"),
)
SKILLS = Table(
    "engine_skills",
    METADATA,
    Column("name", String(64), primary_key=True),
)
WORKERS = Table(
    "engine_workers",
    METADATA,
    Column("executor_id", String(100), primary_key=True),
    Column("app_version", String(100), nullable=False),
    Column("seen_ms", BigInteger, nullable=False),
)


class WorkerBeat(BaseModel):
    executor_id: str
    app_version: str
    seen_ms: int


class WorkflowSummary(BaseModel):
    id: str
    name: str
    description: str | None
    latest_version: int | None
    created_at: str


class VersionSummary(BaseModel):
    version: int
    name: str
    created_at: str


class TriggerRow(BaseModel):
    workflow_id: str
    node_id: str
    version: int
    mode: str
    ref: str | None
