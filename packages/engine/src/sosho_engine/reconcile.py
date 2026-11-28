import asyncio
import logging

from dbos import DBOS
from pydantic import ValidationError

from sosho_engine import runtime
from sosho_engine.jobs import RunParams
from sosho_engine.spec import Workflow
from sosho_engine.spec_nodes import TriggerNode
from sosho_engine.triggers import (
    SCHEDULE_PREFIX,
    bind_spec,
    bindable,
    schedule_name,
    unbind,
)
from sosho_engine.validation import SpecInvalidError

log = logging.getLogger(__name__)
Fact = tuple[str, int, str, str | None]


def _ref(spec: Workflow, node: TriggerNode) -> str | None:
    if node.mode == "cron":
        return schedule_name(spec.id, node.id)
    return node.source_workflow_id if node.mode == "workflow_finished" else None


def _context_version(context: object) -> int | None:
    try:
        return RunParams.model_validate(context).version
    except ValidationError:
        return None


def _in_sync(
    spec: Workflow | None,
    facts: set[Fact],
    tokens: set[str],
    schedules: dict[str, dict[str, object]],
) -> bool:
    nodes = bindable(spec) if spec else []
    want = {(n.id, spec.version, n.mode, _ref(spec, n)) for n in nodes if spec}
    hooks = {n.id for n in nodes if n.mode == "webhook"}
    crons = {schedule_name(spec.id, n.id): n for n in nodes if spec and n.mode == "cron"}
    if facts != want or tokens != hooks or set(schedules) != set(crons):
        return False
    for name, node in crons.items():
        if schedules[name].get("schedule") != node.cron:
            return False
        if _context_version(schedules[name].get("context")) != (spec.version if spec else 0):
            return False
    return True


def _owner(name: str) -> str:
    return name[len(SCHEDULE_PREFIX) :].rsplit(".", 1)[0]


async def reconcile_triggers() -> None:
    store = runtime.current().store
    summaries = await asyncio.to_thread(store.list_workflows)
    rows = await asyncio.to_thread(store.list_triggers)
    hooks = await asyncio.to_thread(store.token_pairs)
    found = await DBOS.list_schedules_async(schedule_name_prefix=SCHEDULE_PREFIX)
    by_owner: dict[str, dict[str, dict[str, object]]] = {}
    for item in found:
        name = str(item["schedule_name"])
        by_owner.setdefault(_owner(name), {})[name] = dict(item)
    known = {item.id for item in summaries}
    stale = ({r.workflow_id for r in rows} | {w for w, _ in hooks} | set(by_owner)) - known
    for workflow_id in sorted(stale):
        await unbind(workflow_id)
        await asyncio.to_thread(store.clear_binding, workflow_id)
        log.info("reconcile: removed stale bindings of %s", workflow_id)
    for item in summaries:
        spec = None
        if item.latest_version:
            spec = await asyncio.to_thread(store.get_version, item.id, item.latest_version)
        facts = {(r.node_id, r.version, r.mode, r.ref) for r in rows if r.workflow_id == item.id}
        tokens = {n for w, n in hooks if w == item.id}
        if _in_sync(spec, facts, tokens, by_owner.get(item.id, {})):
            continue
        try:
            await bind_spec(item.id, spec)
            log.info("reconcile: bound %s to its latest version", item.id)
        except SpecInvalidError as error:
            await unbind(item.id)
            log.warning("reconcile: unbound %s, its latest version cannot bind: %s", item.id, error)
        except Exception:
            log.exception("reconcile: failed to bind %s", item.id)
