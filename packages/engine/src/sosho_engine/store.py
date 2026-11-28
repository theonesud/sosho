import time
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import Engine, create_engine, delete, func, insert, select, text, update
from sqlalchemy.exc import IntegrityError

from sosho_engine.errors import ConflictError, NotFoundError
from sosho_engine.spec import Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.store_tables import (
    HOOK_TOKENS,
    METADATA,
    REPLIES,
    RUNS,
    SKILLS,
    TRIGGERS,
    VERSIONS,
    WORKERS,
    WORKFLOWS,
    TriggerRow,
    VersionSummary,
    WorkerBeat,
    WorkflowSummary,
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, url: str, clock: Callable[[], str] = utc_now) -> None:
        sqlalchemy_url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        self._engine: Engine = create_engine(sqlalchemy_url, pool_pre_ping=True)
        self._clock = clock

    def create_tables(self) -> None:
        METADATA.create_all(self._engine)
        with self._engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS engine_live"))

    def close(self) -> None:
        self._engine.dispose()

    def create_workflow(self, workflow_id: str, name: str, description: str | None) -> None:
        values = {"id": workflow_id, "name": name, "description": description}
        try:
            with self._engine.begin() as conn:
                conn.execute(insert(WORKFLOWS).values(**values, created_at=self._clock()))
        except IntegrityError as error:
            raise ConflictError(f"workflow {workflow_id} exists") from error

    def list_workflows(self) -> list[WorkflowSummary]:
        latest = (
            select(VERSIONS.c.workflow_id, func.max(VERSIONS.c.version).label("latest"))
            .group_by(VERSIONS.c.workflow_id)
            .subquery()
        )
        query = (
            select(WORKFLOWS, latest.c.latest)
            .join(latest, latest.c.workflow_id == WORKFLOWS.c.id, isouter=True)
            .order_by(WORKFLOWS.c.id)
        )
        with self._engine.connect() as conn:
            return [
                WorkflowSummary(
                    id=row.id,
                    name=row.name,
                    description=row.description,
                    created_at=row.created_at,
                    latest_version=row.latest,
                )
                for row in conn.execute(query)
            ]

    def get_workflow(self, workflow_id: str) -> WorkflowSummary:
        for summary in self.list_workflows():
            if summary.id == workflow_id:
                return summary
        raise NotFoundError(f"workflow {workflow_id} not found")

    def update_workflow(self, workflow_id: str, name: str | None, description: str | None) -> None:
        self.get_workflow(workflow_id)
        pairs = (("name", name), ("description", description))
        values = {field: value for field, value in pairs if value is not None}
        if values:
            statement = update(WORKFLOWS).where(WORKFLOWS.c.id == workflow_id).values(**values)
            with self._engine.begin() as conn:
                conn.execute(statement)

    def delete_workflow(self, workflow_id: str) -> None:
        self.get_workflow(workflow_id)
        with self._engine.begin() as conn:
            for table in (TRIGGERS, HOOK_TOKENS):
                conn.execute(delete(table).where(table.c.workflow_id == workflow_id))
            conn.execute(delete(VERSIONS).where(VERSIONS.c.workflow_id == workflow_id))
            conn.execute(delete(WORKFLOWS).where(WORKFLOWS.c.id == workflow_id))

    def add_version(self, workflow_id: str, draft: WorkflowDraft) -> Workflow:
        self.get_workflow(workflow_id)
        newest = select(func.max(VERSIONS.c.version)).where(VERSIONS.c.workflow_id == workflow_id)
        try:
            with self._engine.begin() as conn:
                number = (conn.execute(newest).scalar() or 0) + 1
                spec = draft_to_workflow(draft, workflow_id, number)
                conn.execute(
                    insert(VERSIONS).values(
                        workflow_id=workflow_id,
                        version=number,
                        spec=spec.model_dump_json(),
                        created_at=self._clock(),
                    )
                )
        except IntegrityError as error:
            raise ConflictError(f"version race on workflow {workflow_id}") from error
        return spec

    def get_version(self, workflow_id: str, version: int | None) -> Workflow:
        query = select(VERSIONS.c.spec).where(VERSIONS.c.workflow_id == workflow_id)
        if version:
            query = query.where(VERSIONS.c.version == version)
        else:
            query = query.order_by(VERSIONS.c.version.desc()).limit(1)
        with self._engine.connect() as conn:
            text = conn.execute(query).scalar()
        if text is None:
            raise NotFoundError(f"workflow {workflow_id} version {version or 'latest'} not found")
        return Workflow.model_validate_json(text)

    def list_versions(self, workflow_id: str) -> list[VersionSummary]:
        self.get_workflow(workflow_id)
        query = (
            select(VERSIONS.c.version, VERSIONS.c.spec, VERSIONS.c.created_at)
            .where(VERSIONS.c.workflow_id == workflow_id)
            .order_by(VERSIONS.c.version)
        )
        with self._engine.connect() as conn:
            rows = conn.execute(query).all()
        return [
            VersionSummary(
                version=row.version,
                name=Workflow.model_validate_json(row.spec).name,
                created_at=row.created_at,
            )
            for row in rows
        ]

    def replace_triggers(self, workflow_id: str, rows: list[TriggerRow]) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(TRIGGERS).where(TRIGGERS.c.workflow_id == workflow_id))
            for row in rows:
                conn.execute(insert(TRIGGERS).values(**row.model_dump()))

    def save_binding(
        self, workflow_id: str, rows: list[TriggerRow], tokens: dict[str, str]
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(TRIGGERS).where(TRIGGERS.c.workflow_id == workflow_id))
            for row in rows:
                conn.execute(insert(TRIGGERS).values(**row.model_dump()))
            conn.execute(delete(HOOK_TOKENS).where(HOOK_TOKENS.c.workflow_id == workflow_id))
            for node_id, token in tokens.items():
                conn.execute(
                    insert(HOOK_TOKENS).values(
                        workflow_id=workflow_id, node_id=node_id, token=token
                    )
                )

    def clear_binding(self, workflow_id: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(TRIGGERS).where(TRIGGERS.c.workflow_id == workflow_id))
            conn.execute(delete(HOOK_TOKENS).where(HOOK_TOKENS.c.workflow_id == workflow_id))

    def token_pairs(self) -> list[tuple[str, str]]:
        with self._engine.connect() as conn:
            query = select(HOOK_TOKENS.c.workflow_id, HOOK_TOKENS.c.node_id)
            return [(row.workflow_id, row.node_id) for row in conn.execute(query)]

    def delete_version(self, workflow_id: str, version: int) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                delete(VERSIONS).where(
                    VERSIONS.c.workflow_id == workflow_id, VERSIONS.c.version == version
                )
            )

    def get_tokens(self, workflow_id: str) -> dict[str, str]:
        query = select(HOOK_TOKENS).where(HOOK_TOKENS.c.workflow_id == workflow_id)
        with self._engine.connect() as conn:
            return {row.node_id: row.token for row in conn.execute(query)}

    def set_token(self, workflow_id: str, node_id: str, token: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                delete(HOOK_TOKENS).where(
                    HOOK_TOKENS.c.workflow_id == workflow_id, HOOK_TOKENS.c.node_id == node_id
                )
            )
            conn.execute(
                insert(HOOK_TOKENS).values(workflow_id=workflow_id, node_id=node_id, token=token)
            )

    def list_triggers(self, workflow_id: str | None = None) -> list[TriggerRow]:
        query = select(TRIGGERS)
        if workflow_id is not None:
            query = query.where(TRIGGERS.c.workflow_id == workflow_id)
        with self._engine.connect() as conn:
            return [
                TriggerRow(
                    workflow_id=row.workflow_id,
                    node_id=row.node_id,
                    version=row.version,
                    mode=row.mode,
                    ref=row.ref,
                )
                for row in conn.execute(query)
            ]

    def finished_triggers(self, source_workflow_id: str) -> list[TriggerRow]:
        return [
            row
            for row in self.list_triggers()
            if row.mode == "workflow_finished" and row.ref == source_workflow_id
        ]

    def claim_reply(self, run_id: str) -> bool:
        try:
            with self._engine.begin() as conn:
                conn.execute(insert(REPLIES).values(run_id=run_id))
        except IntegrityError:
            return False
        return True

    def release_reply(self, run_id: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(REPLIES).where(REPLIES.c.run_id == run_id))

    def register_run(self, run_id: str, workflow_id: str) -> None:
        values = {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "created_at": time.time_ns() // 10**6,
        }
        try:
            with self._engine.begin() as conn:
                conn.execute(insert(RUNS).values(**values))
        except IntegrityError:
            return

    def forget_runs(self, run_ids: list[str]) -> None:
        with self._engine.begin() as conn:
            for start in range(0, len(run_ids), 500):
                chunk = run_ids[start : start + 500]
                conn.execute(delete(REPLIES).where(REPLIES.c.run_id.in_(chunk)))
                conn.execute(delete(RUNS).where(RUNS.c.run_id.in_(chunk)))

    def run_ids(self, workflow_id: str, limit: int, offset: int) -> list[str]:
        query = (
            select(RUNS.c.run_id)
            .where(RUNS.c.workflow_id == workflow_id)
            .order_by(RUNS.c.created_at.desc(), RUNS.c.run_id)
            .limit(limit)
            .offset(offset)
        )
        with self._engine.connect() as conn:
            return [row.run_id for row in conn.execute(query)]

    def replace_skills(self, names: list[str]) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(SKILLS))
            for name in names:
                conn.execute(insert(SKILLS).values(name=name))

    def list_skills(self) -> list[str]:
        with self._engine.connect() as conn:
            return [row.name for row in conn.execute(select(SKILLS).order_by(SKILLS.c.name))]

    def beat(self, executor_id: str, app_version: str) -> None:
        values = {
            "executor_id": executor_id,
            "app_version": app_version,
            "seen_ms": time.time_ns() // 10**6,
        }
        with self._engine.begin() as conn:
            conn.execute(delete(WORKERS).where(WORKERS.c.executor_id == executor_id))
            conn.execute(insert(WORKERS).values(**values))

    def workers(self) -> list[WorkerBeat]:
        with self._engine.connect() as conn:
            return [
                WorkerBeat(
                    executor_id=row.executor_id, app_version=row.app_version, seen_ms=row.seen_ms
                )
                for row in conn.execute(select(WORKERS))
            ]
