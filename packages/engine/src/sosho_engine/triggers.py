import asyncio
import hmac
import secrets
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from croniter import croniter
from dbos import DBOS
from pydantic import BaseModel, JsonValue, TypeAdapter

from sosho_engine import runtime
from sosho_engine.chain import has_finished_cycle
from sosho_engine.errors import NotFoundError, RateLimitError
from sosho_engine.issues import Issue
from sosho_engine.jobs import RunParams
from sosho_engine.runflow import scheduled_run
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import TriggerNode
from sosho_engine.store_tables import TriggerRow
from sosho_engine.validation import SpecInvalidError
from sosho_engine.validation_extra import check_cron

SCHEDULE_PREFIX = "wf."
_JSON: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


class ScheduleState(BaseModel):
    name: str
    cron: str
    timezone: str | None
    next_fire: str | None


class WebhookState(BaseModel):
    node_id: str
    url: str
    token: str


class FollowerState(BaseModel):
    source_workflow_id: str
    on_status: str


class TriggerState(BaseModel):
    version: int | None
    schedules: list[ScheduleState]
    webhooks: list[WebhookState]
    followers: list[FollowerState]


class ScheduleInfo(BaseModel):
    name: str
    schedule: str
    status: str
    context: JsonValue = None


def schedule_name(workflow_id: str, node_id: str) -> str:
    return f"{SCHEDULE_PREFIX}{workflow_id}.{node_id}"


def _prefix(workflow_id: str) -> str:
    return f"{SCHEDULE_PREFIX}{workflow_id}."


async def _drop_schedules(workflow_id: str, keep: set[str]) -> None:
    found = await DBOS.list_schedules_async(schedule_name_prefix=_prefix(workflow_id))
    for item in found:
        name = str(item["schedule_name"])
        if name not in keep:
            await DBOS.delete_schedule_async(name)


async def cycle_issues(workflow_id: str, nodes: list[TriggerNode]) -> list[Issue]:
    rows = await asyncio.to_thread(runtime.current().store.list_triggers)
    links = [
        (row.ref, row.workflow_id)
        for row in rows
        if row.mode == "workflow_finished" and row.ref and row.workflow_id != workflow_id
    ]
    own = [n for n in nodes if n.mode == "workflow_finished" and n.source_workflow_id]
    links.extend((node.source_workflow_id or "", workflow_id) for node in own)
    if not has_finished_cycle(links, workflow_id):
        return []
    message = f"workflow {workflow_id} would start a cycle of workflow_finished runs"
    return [Issue("trigger_cycle", message, node.id) for node in own]


async def _bind(
    spec: Workflow, node: TriggerNode, tokens: dict[str, str], known: dict[str, str]
) -> TriggerRow:
    row = TriggerRow(
        workflow_id=spec.id, node_id=node.id, version=spec.version, mode=node.mode, ref=None
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
        return row.model_copy(update={"ref": name})
    if node.mode == "webhook":
        tokens[node.id] = known.get(node.id) or secrets.token_urlsafe(32)
    if node.mode == "workflow_finished":
        return row.model_copy(update={"ref": node.source_workflow_id})
    return row


def bindable(spec: Workflow) -> list[TriggerNode]:
    return [n for n in spec.nodes if isinstance(n, TriggerNode) and n.mode != "manual"]


async def bind_issues(spec: Workflow) -> list[Issue]:
    nodes = bindable(spec)
    issues = [issue for node in nodes if node.mode == "cron" for issue in check_cron(node)]
    issues.extend(await cycle_issues(spec.id, nodes))
    return issues


async def bind_spec(workflow_id: str, spec: Workflow | None) -> None:
    store = runtime.current().store
    nodes = bindable(spec) if spec else []
    if spec:
        issues = await bind_issues(spec)
        if issues:
            raise SpecInvalidError(issues)
    known = await asyncio.to_thread(store.get_tokens, workflow_id)
    tokens: dict[str, str] = {}
    rows = [await _bind(spec, node, tokens, known) for node in nodes] if spec else []
    await asyncio.to_thread(store.save_binding, workflow_id, rows, tokens)
    keep = {row.ref for row in rows if row.mode == "cron" and row.ref}
    await _drop_schedules(workflow_id, {name for name in keep if name})


async def bind_latest(workflow_id: str) -> None:
    store = runtime.current().store
    summary = await asyncio.to_thread(store.get_workflow, workflow_id)
    spec = None
    if summary.latest_version:
        spec = await asyncio.to_thread(store.get_version, workflow_id, summary.latest_version)
    await bind_spec(workflow_id, spec)


async def unbind(workflow_id: str) -> None:
    await _drop_schedules(workflow_id, set())
    await asyncio.to_thread(runtime.current().store.clear_binding, workflow_id)


def webhook_url(workflow_id: str, node_id: str) -> str:
    base = runtime.current().settings.public_url.rstrip("/")
    return f"{base}/webhooks/{workflow_id}/{node_id}"


def _next_fire(node: TriggerNode) -> str | None:
    zone = ZoneInfo(node.cron_timezone) if node.cron_timezone else UTC
    try:
        moment = croniter(node.cron or "", datetime.now(zone), second_at_beginning=True)
        return moment.get_next(datetime).isoformat()
    except ValueError:
        return None


async def trigger_state(workflow_id: str) -> TriggerState:
    store = runtime.current().store
    summary = await asyncio.to_thread(store.get_workflow, workflow_id)
    state = TriggerState(version=summary.latest_version, schedules=[], webhooks=[], followers=[])
    if summary.latest_version is None:
        return state
    spec = await asyncio.to_thread(store.get_version, workflow_id, summary.latest_version)
    tokens = await asyncio.to_thread(store.get_tokens, workflow_id)
    for node in bindable(spec):
        if node.mode == "cron":
            name = schedule_name(workflow_id, node.id)
            state.schedules.append(
                ScheduleState(
                    name=name,
                    cron=node.cron or "",
                    timezone=node.cron_timezone,
                    next_fire=_next_fire(node),
                )
            )
        elif node.mode == "webhook" and node.id in tokens:
            url = webhook_url(workflow_id, node.id)
            state.webhooks.append(WebhookState(node_id=node.id, url=url, token=tokens[node.id]))
        elif node.mode == "workflow_finished":
            source = node.source_workflow_id or ""
            state.followers.append(
                FollowerState(source_workflow_id=source, on_status=node.on_status)
            )
    return state


async def regenerate_token(workflow_id: str, node_id: str) -> WebhookState:
    store = runtime.current().store
    rows = await asyncio.to_thread(store.list_triggers, workflow_id)
    if not any(row.node_id == node_id and row.mode == "webhook" for row in rows):
        raise NotFoundError("webhook not found")
    token = secrets.token_urlsafe(32)
    await asyncio.to_thread(store.set_token, workflow_id, node_id, token)
    return WebhookState(node_id=node_id, url=webhook_url(workflow_id, node_id), token=token)


async def verify_webhook(workflow_id: str, node_id: str, token: str) -> TriggerRow:
    if not runtime.current().webhook_limiter.allow(f"{workflow_id}/{node_id}"):
        raise RateLimitError("too many webhook requests for this trigger")
    store = runtime.current().store
    rows = await asyncio.to_thread(store.list_triggers, workflow_id)
    row = next((item for item in rows if item.node_id == node_id and item.mode == "webhook"), None)
    stored = (await asyncio.to_thread(store.get_tokens, workflow_id)).get(node_id)
    expected = stored if stored is not None else token
    matches = hmac.compare_digest(token.encode(), expected.encode())
    if row is None or stored is None or not matches:
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
