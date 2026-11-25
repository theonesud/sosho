import asyncio
import hashlib
import hmac
import secrets
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from dbos import DBOS
from pydantic import BaseModel, JsonValue, TypeAdapter

from sosho_engine import runtime
from sosho_engine.chain import has_finished_cycle
from sosho_engine.errors import ConflictError, NotFoundError, RateLimitError
from sosho_engine.jobs import RunParams
from sosho_engine.runflow import scheduled_run
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import TriggerNode
from sosho_engine.store_tables import TriggerRow
from sosho_engine.validation import Issue, SpecInvalidError

SCHEDULE_PREFIX = "wf."
_JSON: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


class Activation(BaseModel):
    workflow_id: str
    version: int
    schedules: list[str]
    webhook_tokens: dict[str, str]
    finished_sources: list[str]


class ScheduleInfo(BaseModel):
    name: str
    schedule: str
    status: str
    context: JsonValue = None


def schedule_name(workflow_id: str, node_id: str) -> str:
    return f"{SCHEDULE_PREFIX}{workflow_id}.{node_id}"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _prefix(workflow_id: str) -> str:
    return f"{SCHEDULE_PREFIX}{workflow_id}."


async def _drop_schedules(workflow_id: str, keep: set[str]) -> None:
    found = await DBOS.list_schedules_async(schedule_name_prefix=_prefix(workflow_id))
    for item in found:
        name = str(item["schedule_name"])
        if name not in keep:
            await DBOS.delete_schedule_async(name)


def _check_cron(node: TriggerNode) -> list[Issue]:
    issues: list[Issue] = []
    if not croniter.is_valid(node.cron or "", second_at_beginning=True):
        issues.append(Issue("bad_cron", f"cron string {node.cron} is not valid", node.id))
    if node.cron_timezone:
        try:
            ZoneInfo(node.cron_timezone)
        except (ZoneInfoNotFoundError, ModuleNotFoundError, ValueError):
            issues.append(
                Issue("bad_timezone", f"time zone {node.cron_timezone} is unknown", node.id)
            )
    return issues


async def _refuse_cycle(workflow_id: str, nodes: list[TriggerNode]) -> None:
    rows = await asyncio.to_thread(runtime.current().store.list_triggers)
    links = [
        (row.ref, row.workflow_id)
        for row in rows
        if row.mode == "workflow_finished" and row.ref and row.workflow_id != workflow_id
    ]
    links.extend(
        (node.source_workflow_id, workflow_id)
        for node in nodes
        if node.mode == "workflow_finished" and node.source_workflow_id
    )
    if has_finished_cycle(links, workflow_id):
        raise ConflictError(f"workflow {workflow_id} would start a cycle of workflow_finished runs")


async def _bind(spec: Workflow, node: TriggerNode, result: Activation) -> TriggerRow:
    row = TriggerRow(
        workflow_id=spec.id,
        node_id=node.id,
        version=spec.version,
        mode=node.mode,
        ref=None,
        secret_hash=None,
    )
    if node.mode == "cron" and node.cron:
        name = schedule_name(spec.id, node.id)
        context = RunParams(workflow_id=spec.id, version=spec.version, trigger_node=node.id)
        if await DBOS.get_schedule_async(name):
            await DBOS.delete_schedule_async(name)
        await DBOS.create_schedule_async(
            schedule_name=name,
            workflow_fn=scheduled_run,
            schedule=node.cron,
            context=context.model_dump(mode="json"),
            cron_timezone=node.cron_timezone,
        )
        result.schedules.append(name)
        return row.model_copy(update={"ref": name})
    if node.mode == "webhook":
        token = secrets.token_urlsafe(32)
        result.webhook_tokens[node.id] = token
        return row.model_copy(update={"secret_hash": hash_token(token)})
    if node.mode == "workflow_finished":
        result.finished_sources.append(node.source_workflow_id or "")
        return row.model_copy(update={"ref": node.source_workflow_id})
    return row


async def activate(workflow_id: str, version: int | None) -> Activation:
    store = runtime.current().store
    spec = await asyncio.to_thread(store.get_version, workflow_id, version)
    nodes = [n for n in spec.nodes if isinstance(n, TriggerNode) and n.mode != "manual"]
    issues = [issue for node in nodes if node.mode == "cron" for issue in _check_cron(node)]
    if issues:
        raise SpecInvalidError(issues)
    await _refuse_cycle(workflow_id, nodes)
    result = Activation(
        workflow_id=workflow_id,
        version=spec.version,
        schedules=[],
        webhook_tokens={},
        finished_sources=[],
    )
    rows = [await _bind(spec, node, result) for node in nodes]
    await asyncio.to_thread(store.replace_triggers, workflow_id, rows)
    await _drop_schedules(workflow_id, set(result.schedules))
    return result


async def deactivate(workflow_id: str) -> None:
    await _drop_schedules(workflow_id, set())
    await asyncio.to_thread(runtime.current().store.replace_triggers, workflow_id, [])


async def verify_webhook(workflow_id: str, node_id: str, token: str) -> TriggerRow:
    if not runtime.current().webhook_limiter.allow(f"{workflow_id}/{node_id}"):
        raise RateLimitError("too many webhook requests for this trigger")
    rows = await asyncio.to_thread(runtime.current().store.list_triggers, workflow_id)
    row = next((item for item in rows if item.node_id == node_id and item.mode == "webhook"), None)
    candidate = hash_token(token)
    expected = row.secret_hash if row is not None and row.secret_hash is not None else candidate
    matches = hmac.compare_digest(candidate, expected)
    if row is None or row.secret_hash is None or not matches:
        raise NotFoundError("webhook not found")
    return row


def _info(item: dict[str, object]) -> ScheduleInfo:
    context = item.get("context")
    return ScheduleInfo(
        name=str(item["schedule_name"]),
        schedule=str(item["schedule"]),
        status=str(item["status"]),
        context=_JSON.validate_python(context) if isinstance(context, dict) else None,
    )


async def list_schedules() -> list[ScheduleInfo]:
    items = await DBOS.list_schedules_async(schedule_name_prefix=SCHEDULE_PREFIX)
    return [_info(dict(item)) for item in items]


async def _require_schedule(name: str) -> None:
    if not name.startswith(SCHEDULE_PREFIX) or await DBOS.get_schedule_async(name) is None:
        raise NotFoundError(f"schedule {name} not found")


async def manage_schedule(name: str, action: str) -> None:
    await _require_schedule(name)
    if action == "pause":
        await DBOS.pause_schedule_async(name)
    elif action == "resume":
        await DBOS.resume_schedule_async(name)
    elif action == "trigger":
        await asyncio.to_thread(DBOS.trigger_schedule, name)
    elif action == "delete":
        await DBOS.delete_schedule_async(name)
    else:
        raise NotFoundError(f"schedule action {action} is unknown")
