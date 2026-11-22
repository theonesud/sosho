from pathlib import Path

import pytest
from pydantic import JsonValue
from sosho_graph.run_events import RunEvent
from support import FakeModels, agent, build_graph, node_of, runtime


@pytest.mark.anyio
async def test_linear_graph_writes_each_node_output(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            agent("first", "Write about {{topic}}", "draft"),
            agent("second", "Improve: {{draft}}", "final"),
        ],
        edges=[("start", "first", None), ("first", "second", None)],
        entry="start",
    )
    models = FakeModels({"main": ["hello", "better hello"]})
    async with runtime(tmp_path / "linear.sqlite", models.services()) as manager:
        record = await manager.start(graph, {"topic": "rivers"}, None)
        await manager.wait(record.run_id)
        detail = await manager.detail(record.run_id)
    assert detail.status == "completed"
    assert detail.data["draft"] == "hello"
    assert detail.data["final"] == "better hello"


def _subagent(node_id: str, output_key: str) -> dict[str, JsonValue]:
    return node_of(
        node_id,
        "subagent",
        role=node_id,
        promptTemplate="Answer {{topic}}",
        outputKey=output_key,
    )


@pytest.mark.anyio
async def test_decision_routes_to_the_chosen_branch_only(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            node_of(
                "route",
                "decision",
                promptTemplate="Pick quick or deep for {{topic}}",
                branches=["quick", "deep"],
            ),
            _subagent("quick_path", "quick_out"),
            _subagent("deep_path", "deep_out"),
        ],
        edges=[
            ("start", "route", None),
            ("route", "quick_path", "quick"),
            ("route", "deep_path", "deep"),
        ],
        entry="start",
    )
    models = FakeModels({"decision": ['{"branch": "quick", "reason": "short"}'], "subagent": ["q"]})
    async with runtime(tmp_path / "branch.sqlite", models.services()) as manager:
        record = await manager.start(graph, {"topic": "rivers"}, None)
        await manager.wait(record.run_id)
        detail = await manager.detail(record.run_id)
    assert detail.status == "completed"
    assert detail.data["decision"] == "quick"
    assert detail.data["quick_out"] == "q"
    assert "deep_out" not in detail.data


@pytest.mark.anyio
async def test_cycle_stops_at_max_steps_with_max_steps_exceeded(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            agent("work", "Work on {{topic}}", "draft"),
            node_of(
                "judge",
                "decision",
                promptTemplate="Judge {{draft}}",
                branches=["again", "stop"],
            ),
            node_of("finish", "end"),
        ],
        edges=[
            ("start", "work", None),
            ("work", "judge", None),
            ("judge", "work", "again"),
            ("judge", "finish", "stop"),
        ],
        entry="start",
        max_steps=6,
    )
    models = FakeModels({"decision": ['{"branch": "again"}'], "main": ["draft"]})
    async with runtime(tmp_path / "cycle.sqlite", models.services()) as manager:
        record = await manager.start(graph, {"topic": "rivers"}, None)
        await manager.wait(record.run_id)
        detail = await manager.detail(record.run_id)
    assert detail.status == "failed"
    assert detail.error == "max_steps_exceeded"


@pytest.mark.anyio
async def test_fan_out_branches_run_and_join_runs_once(tmp_path: Path) -> None:
    graph = build_graph(
        nodes=[
            node_of("start", "start"),
            agent("critic_a", "A on {{topic}}", "a", tier="main"),
            agent("critic_b", "B on {{topic}}", "b", tier="subagent"),
            agent("critic_c", "C on {{topic}}", "c", tier="subagent-code"),
            agent("join", "Join {{a}} {{b}} {{c}}", "final", tier="local-uncensored"),
        ],
        edges=[
            ("start", "critic_a", None),
            ("start", "critic_b", None),
            ("start", "critic_c", None),
            ("critic_a", "join", None),
            ("critic_b", "join", None),
            ("critic_c", "join", None),
        ],
        entry="start",
    )
    models = FakeModels(
        {
            "main": ["ra"],
            "subagent": ["rb"],
            "subagent-code": ["rc"],
            "local-uncensored": ["joined"],
        }
    )
    async with runtime(tmp_path / "fan.sqlite", models.services()) as manager:
        record = await manager.start(graph, {"topic": "rivers"}, None)
        await manager.wait(record.run_id)
        detail = await manager.detail(record.run_id)
        events: list[RunEvent] = [event async for event in manager.stream_events(record.run_id)]
    assert detail.status == "completed"
    assert detail.data["final"] == "joined"
    join_starts = [e for e in events if e.type == "node_start" and e.node_id == "join"]
    assert len(join_starts) == 1
