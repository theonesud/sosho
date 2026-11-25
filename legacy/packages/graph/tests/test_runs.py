import asyncio
from pathlib import Path

import pytest
from pydantic import Field
from sosho_graph.nodes import default_kinds
from sosho_graph.nodes.checkpoint import HumanDecision
from sosho_graph.registry import NodeConfig, NodeContext, NodeRegistry, TypedNodeKind
from sosho_graph.run_events import RunEvent
from sosho_graph.runs import RunConflictError
from sosho_graph.schema import GraphDefinition
from sosho_graph.state import NodeUpdate
from support import FakeModels, agent, build_graph, node_of, runtime


class SleepConfig(NodeConfig):
    seconds: float = Field(default=60.0, ge=0)


async def run_sleep(ctx: NodeContext, node: SleepConfig) -> NodeUpdate:
    await asyncio.sleep(node.seconds)
    return {}


SLEEP_KIND = TypedNodeKind(
    type_id="sleep",
    display_name="Sleep",
    description="Test only.",
    config_model=SleepConfig,
    output_schema={"type": "object"},
    runner=run_sleep,
)


def _review_graph() -> GraphDefinition:
    return build_graph(
        nodes=[
            node_of("start", "start"),
            agent("draft", "Draft {{topic}}", "draft"),
            node_of("review", "checkpoint", message="Review the draft"),
            node_of("finish", "end"),
        ],
        edges=[
            ("start", "draft", None),
            ("draft", "review", None),
            ("review", "finish", "approve"),
            ("review", "draft", "reject"),
        ],
        entry="start",
    )


def _decision(action: str, patch: dict[str, object] | None = None) -> HumanDecision:
    payload: dict[str, object] = {"action": action}
    if patch is not None:
        payload["statePatch"] = patch
    return HumanDecision.model_validate(payload)


@pytest.mark.anyio
async def test_checkpoint_pauses_then_reject_and_approve_resume(tmp_path: Path) -> None:
    graph = _review_graph()
    models = FakeModels({"main": ["v1", "v2"]})
    async with runtime(tmp_path / "hitl.sqlite", models.services()) as manager:
        record = await manager.start(graph, {"topic": "rivers"}, None)
        await manager.wait(record.run_id)
        paused = await manager.detail(record.run_id)
        assert paused.status == "waiting_checkpoint"
        assert paused.interrupts[0] == {
            "nodeId": "review",
            "value": {
                "nodeId": "review",
                "message": "Review the draft",
                "data": {"topic": "rivers", "draft": "v1"},
            },
        }

        await manager.resume(record.run_id, _decision("reject"))
        await manager.wait(record.run_id)
        assert (await manager.detail(record.run_id)).data["draft"] == "v2"

        await manager.resume(record.run_id, _decision("approve", {"note": "ship it"}))
        await manager.wait(record.run_id)
        done = await manager.detail(record.run_id)
    assert done.status == "completed"
    assert done.data["note"] == "ship it"


@pytest.mark.anyio
async def test_resume_rejects_a_run_that_is_not_waiting(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[node_of("start", "start"), agent("draft", "Draft", "draft")],
        edges=[("start", "draft", None)],
        entry="start",
    )
    models = FakeModels({"main": ["done"]})
    async with runtime(tmp_path / "conflict.sqlite", models.services()) as manager:
        record = await manager.start(graph, {}, None)
        await manager.wait(record.run_id)
        with pytest.raises(RunConflictError):
            await manager.resume(record.run_id, _decision("approve"))


@pytest.mark.anyio
async def test_resume_survives_a_restart_of_the_service(tmp_path: Path) -> None:
    db = tmp_path / "restart.sqlite"
    run_id = ""
    async with runtime(db, FakeModels({"main": ["v1"]}).services()) as first:
        record = await first.start(_review_graph(), {"topic": "rivers"}, None)
        await first.wait(record.run_id)
        run_id = record.run_id
    async with runtime(db, FakeModels({"main": ["v2"]}).services()) as second:
        assert (await second.detail(run_id)).status == "waiting_checkpoint"
        await second.resume(run_id, _decision("approve"))
        await second.wait(run_id)
        assert (await second.detail(run_id)).status == "completed"


@pytest.mark.anyio
async def test_cancel_stops_a_running_node(tmp_path: Path) -> None:
    registry = NodeRegistry([*default_kinds(), SLEEP_KIND])
    graph = build_graph(
        nodes=[node_of("start", "start"), node_of("wait", "sleep", seconds=60)],
        edges=[("start", "wait", None)],
        entry="start",
    )
    async with runtime(tmp_path / "cancel.sqlite", FakeModels({}).services(), registry) as manager:
        record = await manager.start(graph, {}, None)
        await asyncio.sleep(0)
        cancelled = await manager.cancel(record.run_id)
        detail = await manager.detail(record.run_id)
        events: list[RunEvent] = [event async for event in manager.stream_events(record.run_id)]
    assert cancelled.status == "cancelled"
    assert detail.status == "cancelled"
    assert events[-1].type == "done"


@pytest.mark.anyio
async def test_cancel_a_waiting_run_without_a_task(tmp_path: Path) -> None:
    async with runtime(
        tmp_path / "wait-cancel.sqlite", FakeModels({"main": ["v1"]}).services()
    ) as m:
        record = await m.start(_review_graph(), {"topic": "x"}, None)
        await m.wait(record.run_id)
        await m.cancel(record.run_id)
        with pytest.raises(RunConflictError):
            await m.cancel(record.run_id)
        assert (await m.detail(record.run_id)).status == "cancelled"


@pytest.mark.anyio
async def test_event_stream_reports_node_tokens_and_done(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[node_of("start", "start"), agent("draft", "Draft", "draft")],
        edges=[("start", "draft", None)],
        entry="start",
    )
    async with runtime(tmp_path / "events.sqlite", FakeModels({"main": ["hi"]}).services()) as m:
        record = await m.start(graph, {}, None)
        events: list[RunEvent] = [event async for event in m.stream_events(record.run_id)]
    kinds = [(event.type, event.node_id) for event in events]
    assert ("node_start", "draft") in kinds
    assert ("node_end", "draft") in kinds
    tokens = "".join(str(e.data["text"]) for e in events if e.type == "token")
    assert tokens == "hi"
    assert [event.seq for event in events] == list(range(1, len(events) + 1))
    assert events[-1].type == "done"
    assert events[-1].data == {"status": "completed"}
