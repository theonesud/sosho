import asyncio

import pytest
from dbos import DBOS
from engine_support import Api, dig, publish, run_to_end
from flows import (
    DIRECT_ROLE,
    LONG,
    MISSING_ROLE,
    PI_ROLE,
    SHORT,
    Spec,
    draft,
    edge,
    llm,
    trigger,
    unique,
)
from pydantic import JsonValue
from pydantic_ai.exceptions import ModelHTTPError
from sosho_engine.executors import run_llm
from sosho_engine.host_node import llm_output
from sosho_engine.jobs import NodeJob
from sosho_engine.spec import Workflow, WorkflowDraft, draft_to_workflow
from sosho_engine.spec_nodes import LlmNode
from sosho_engine.validation import validate_workflow
from worker_support import wait_pi

KEYS = {"text", "role"}


def _run(api: Api, nodes: list[JsonValue], **extra: JsonValue) -> JsonValue:
    wid = unique("place")
    edges: list[JsonValue] = [edge("start", "n")]
    publish(api, draft([trigger(), *nodes], edges, **extra), wid)
    return run_to_end(api, wid)


def _rows(detail: JsonValue) -> dict[str, tuple[str | None, str | None]]:
    run_id = str(dig(detail, "summary", "run_id"))
    rows = DBOS.list_workflows(workflow_id_prefix=run_id)
    return {row.workflow_id: (row.queue_name, row.executor_id) for row in rows}


def _codes(node: Spec) -> set[str]:
    body = WorkflowDraft.model_validate(draft([trigger(), node], [edge("start", "n")]))
    spec: Workflow = draft_to_workflow(body, "wf", 1)
    return {issue.code for issue in validate_workflow(spec)}


def test_decision_role_runs_direct_in_the_engine_without_a_child_run(live_api: Api) -> None:
    detail = _run(live_api, [llm("n", SHORT, role=DIRECT_ROLE)])
    assert dig(detail, "summary", "status") == "succeeded"
    output = dig(detail, "output", "output", "n")
    assert isinstance(output, dict)
    assert set(output) == KEYS
    assert output["role"] == DIRECT_ROLE
    assert str(output["text"]).strip()
    assert set(_rows(detail)) == {str(dig(detail, "summary", "run_id"))}
    assert dig(detail, "output", "llm_calls") == 1


def test_direct_role_llm_node_may_use_the_cloud_io_queue(live_api: Api) -> None:
    detail = _run(live_api, [llm("n", SHORT, role=DIRECT_ROLE, queue="cloud-io")])
    assert dig(detail, "summary", "status") == "succeeded"
    run_id = str(dig(detail, "summary", "run_id"))
    assert _rows(detail)[f"{run_id}:n:1"][0] == "cloud-io"


def test_direct_model_error_raises_the_litellm_error(live_api: Api) -> None:
    node = LlmNode(id="n", role=MISSING_ROLE, prompt=SHORT)
    job = NodeJob(run_id="direct", node=node, data={}, llm_left=5)
    with pytest.raises(ModelHTTPError) as caught:
        asyncio.run(run_llm(node, job))
    assert caught.value.status_code in (400, 404)
    assert MISSING_ROLE in str(caught.value.body)


def test_timeout_kills_the_pi_session_of_an_llm_node(live_host_api: Api) -> None:
    tag = unique("llmtmo-")
    detail = _run(
        live_host_api, [llm("n", f"{LONG} {tag}", role=PI_ROLE, thinking="off", timeout_seconds=1)]
    )
    assert dig(detail, "summary", "status") == "failed"
    assert "pi ran longer than 1" in str(dig(detail, "error"))
    assert wait_pi(tag, running=False)


def test_queue_local_gpu_is_rejected_with_a_clear_error(api: Api) -> None:
    body = draft([trigger(), llm("n", "hi", role=PI_ROLE, queue="local-gpu")], [edge("start", "n")])
    created = api.post("/workflows", {"id": (wid := unique("gpu")), "name": wid})
    assert created.status == 201
    response = api.post(f"/workflows/{wid}/versions", body)
    assert response.status == 422
    assert "queue local-gpu does not exist" in response.text


def test_pi_llm_node_accepts_only_the_host_queue() -> None:
    assert _codes(llm("n", "hi", role=PI_ROLE, queue="host")) == set()
    assert _codes(llm("n", "hi", role=PI_ROLE, queue="cloud-io")) == {"host_queue"}


def test_direct_llm_node_cannot_use_the_host_queue() -> None:
    assert _codes(llm("n", "hi", role=DIRECT_ROLE, queue="host")) == {"host_queue"}
    assert _codes(llm("n", "hi", role=DIRECT_ROLE, queue="cloud-io")) == set()


def test_direct_llm_node_rejects_thinking_and_a_pi_llm_node_accepts_it() -> None:
    assert _codes(llm("n", "hi", role=DIRECT_ROLE, thinking="off")) == {"thinking_direct"}
    assert _codes(llm("n", "hi", role=PI_ROLE, thinking="off")) == set()


def test_llm_output_parses_fenced_json_like_the_direct_path() -> None:
    node = LlmNode(id="n", role=PI_ROLE, prompt="p", json_output=True)
    assert llm_output('```json\n{"a": 1}\n```', node) == {
        "text": '```json\n{"a": 1}\n```',
        "role": PI_ROLE,
        "data": {"a": 1},
    }
