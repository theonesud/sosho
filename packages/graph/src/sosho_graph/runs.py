"""Run lifecycle: start, resume after an interrupt, cancel, and event streams."""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from functools import partial
from typing import Literal

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.runnables import RunnableConfig
from langgraph.errors import GraphRecursionError
from langgraph.types import Command
from pydantic import JsonValue

from sosho_graph.compiler import compile_graph
from sosho_graph.nodes.checkpoint import HumanDecision
from sosho_graph.registry import NodeRegistry, Services
from sosho_graph.run_detail import pending_interrupts, run_data
from sosho_graph.run_events import EventDraft, RunEvent, drafts_from_part
from sosho_graph.run_store import TERMINAL_STATUSES, RunRow, RunStatus, RunStore
from sosho_graph.schema import GraphDefinition
from sosho_graph.state import Checkpointer, GraphApp, GraphState

logger = logging.getLogger(__name__)

MAX_STEPS_EXCEEDED = "max_steps_exceeded"
STREAM_MODES: list[Literal["tasks", "messages"]] = ["tasks", "messages"]
RESTART_MESSAGE = "service restarted before the run finished"


class RunNotFoundError(LookupError):
    """Raised when a run id is unknown."""


class RunConflictError(ValueError):
    """Raised when an action does not fit the current run status."""


@dataclass(frozen=True)
class RunDetail:
    """Status, data, and pending interrupts of one run."""

    run_id: str
    thread_id: str
    graph_id: str
    status: RunStatus
    error: str | None
    created_at: str
    updated_at: str
    data: dict[str, JsonValue]
    interrupts: list[JsonValue]


@dataclass
class RunRecord:
    """In-memory state of one run. The store keeps the durable copy."""

    run_id: str
    thread_id: str
    graph: GraphDefinition
    app: GraphApp
    status: RunStatus
    created_at: str
    updated_at: str
    error: str | None = None
    events: list[RunEvent] = field(default_factory=list[RunEvent])
    changed: asyncio.Condition = field(default_factory=asyncio.Condition)
    task: asyncio.Task[None] | None = None


@dataclass(frozen=True)
class RunDeps:
    """Collaborators of the run manager."""

    store: RunStore
    checkpointer: Checkpointer
    registry: NodeRegistry
    services: Services
    callbacks: list[BaseCallbackHandler]


def _has_pending(record: RunRecord, index: int) -> bool:
    return len(record.events) > index or record.task is None


class RunManager:
    """Owns the runs of this process. Every status change reaches the store."""

    def __init__(self, deps: RunDeps, clock: Callable[[], str], new_id: Callable[[], str]) -> None:
        self._store = deps.store
        self._checkpointer = deps.checkpointer
        self._registry = deps.registry
        self._services = deps.services
        self._callbacks = deps.callbacks
        self._clock = clock
        self._new_id = new_id
        self._runs: dict[str, RunRecord] = {}

    def _compile(self, graph: GraphDefinition) -> GraphApp:
        return compile_graph(graph, self._registry, self._services, self._checkpointer)

    def _config(self, record: RunRecord) -> RunnableConfig:
        return {
            "configurable": {"thread_id": record.thread_id},
            "recursion_limit": record.graph.max_steps,
            "callbacks": list(self._callbacks),
            "metadata": {"run_id": record.run_id, "graph_id": record.graph.id},
        }

    async def _persist(self, record: RunRecord) -> None:
        await self._store.save(
            RunRow(
                run_id=record.run_id,
                thread_id=record.thread_id,
                graph=record.graph,
                status=record.status,
                error=record.error,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
        )

    async def _set_status(self, record: RunRecord, status: RunStatus, error: str | None) -> None:
        record.status = status
        record.error = error
        record.updated_at = self._clock()
        await self._persist(record)

    async def _emit(self, record: RunRecord, draft: EventDraft) -> None:
        async with record.changed:
            seq = len(record.events) + 1
            event = RunEvent(
                seq=seq, type=draft.type, node_id=draft.node_id, data=draft.data, at=self._clock()
            )
            record.events.append(event)
            record.changed.notify_all()

    async def start(
        self, graph: GraphDefinition, input_data: dict[str, JsonValue], thread_id: str | None
    ) -> RunRecord:
        """Compile the graph, record the run, and start it in the background."""
        app = self._compile(graph)
        now = self._clock()
        record = RunRecord(
            run_id=self._new_id(),
            thread_id=thread_id or self._new_id(),
            graph=graph,
            app=app,
            status="running",
            created_at=now,
            updated_at=now,
        )
        self._runs[record.run_id] = record
        await self._persist(record)
        payload = GraphState(data=input_data, branches={})
        record.task = asyncio.create_task(self._execute(record, payload))
        return record

    async def resume(self, run_id: str, decision: HumanDecision) -> RunRecord:
        """Resume a run that waits at a checkpoint with a human decision."""
        record = await self.require(run_id)
        self._require_waiting(record)
        if decision.node_id is not None:
            await self._require_pending_node(record, decision.node_id)
        # Check and set the status without an await in between. Two resumes cannot start twice.
        self._require_waiting(record)
        record.status = "running"
        record.error = None
        record.updated_at = self._clock()
        command = Command[str](resume=decision.model_dump(by_alias=True, exclude_none=True))
        record.task = asyncio.create_task(self._execute(record, command))
        await self._persist(record)
        return record

    def _require_waiting(self, record: RunRecord) -> None:
        if record.status != "waiting_checkpoint":
            raise RunConflictError(
                f"run '{record.run_id}' is '{record.status}', not waiting_checkpoint"
            )

    async def _require_pending_node(self, record: RunRecord, node_id: str) -> None:
        snapshot = await record.app.aget_state(self._config(record))
        pending = [task.name for task in snapshot.tasks if task.interrupts]
        if node_id not in pending:
            raise RunConflictError(f"checkpoint '{node_id}' is not pending in '{record.run_id}'")

    async def cancel(self, run_id: str) -> RunRecord:
        """Cancel a run. A terminal run raises RunConflictError."""
        record = await self.require(run_id)
        if record.status in TERMINAL_STATUSES:
            raise RunConflictError(f"run '{run_id}' is already '{record.status}'")
        task = record.task
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if record.status not in TERMINAL_STATUSES:
            # The task never started, so its cleanup did not run. Finish the run here.
            await self._set_status(record, "cancelled", None)
            await self._emit(record, EventDraft("done", None, {"status": "cancelled"}))
        record.task = None
        return record

    async def require(self, run_id: str) -> RunRecord:
        """Return the run from memory, or load it from the store after a restart."""
        record = self._runs.get(run_id)
        if record is not None:
            return record
        row = await self._store.get(run_id)
        if row is None:
            raise RunNotFoundError(f"run '{run_id}' not found")
        record = RunRecord(
            run_id=row.run_id,
            thread_id=row.thread_id,
            graph=row.graph,
            app=self._compile(row.graph),
            status=row.status,
            created_at=row.created_at,
            updated_at=row.updated_at,
            error=row.error,
        )
        self._runs[run_id] = record
        return record

    async def list_runs(self, limit: int) -> list[RunRow]:
        """Return stored runs, newest first."""
        return await self._store.list_recent(limit)

    async def detail(self, run_id: str) -> RunDetail:
        """Return the status, data, and pending interrupts of one run."""
        record = await self.require(run_id)
        snapshot = await record.app.aget_state(self._config(record))
        return RunDetail(
            run_id=record.run_id,
            thread_id=record.thread_id,
            graph_id=record.graph.id,
            status=record.status,
            error=record.error,
            created_at=record.created_at,
            updated_at=record.updated_at,
            data=run_data(snapshot.values),
            interrupts=pending_interrupts(snapshot.tasks),
        )

    async def stream_events(self, run_id: str, after: int = 0) -> AsyncIterator[RunEvent]:
        """Yield the events after a sequence number. Stop after a done event."""
        record = await self.require(run_id)
        index = after
        while True:
            async with record.changed:
                await record.changed.wait_for(partial(_has_pending, record, index))
                if len(record.events) <= index:
                    return
                event = record.events[index]
            index += 1
            yield event
            if event.type == "done":
                return

    async def wait(self, run_id: str) -> None:
        """Wait until the current execution of a run ends."""
        record = await self.require(run_id)
        if record.task is not None:
            await asyncio.gather(record.task, return_exceptions=True)

    async def _execute(self, record: RunRecord, payload: GraphState | Command[str]) -> None:
        config = self._config(record)
        await self._set_status(record, "running", None)
        try:
            async for part in record.app.astream(
                payload, config, stream_mode=STREAM_MODES, version="v2"
            ):
                for draft in drafts_from_part(part):
                    await self._emit(record, draft)
            snapshot = await record.app.aget_state(config)
            status: RunStatus = "waiting_checkpoint" if snapshot.next else "completed"
            await self._set_status(record, status, None)
        except GraphRecursionError:
            await self._finish_failed(record, MAX_STEPS_EXCEEDED)
        except asyncio.CancelledError:
            await self._set_status(record, "cancelled", None)
            await self._emit(record, EventDraft("done", None, {"status": "cancelled"}))
            record.task = None
            raise
        except Exception as error:
            logger.exception("run failed run_id=%s", record.run_id)
            await self._finish_failed(record, str(error))
        else:
            await self._emit(record, EventDraft("done", None, {"status": record.status}))
        record.task = None

    async def _finish_failed(self, record: RunRecord, message: str) -> None:
        await self._set_status(record, "failed", message)
        await self._emit(record, EventDraft("error", None, {"message": message}))
        await self._emit(record, EventDraft("done", None, {"status": "failed"}))

    async def fail_unfinished(self) -> int:
        """Mark stored runs with status running as failed after a restart."""
        return await self._store.fail_unfinished(RESTART_MESSAGE, self._clock())

    async def shutdown(self) -> None:
        """Cancel every active run and wait for the cancellations to finish."""
        tasks = [record.task for record in self._runs.values() if record.task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
