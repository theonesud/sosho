from engine_support import AUTH, TOKEN, Api, dig
from fastapi.testclient import TestClient
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue

KINDS = {
    "trigger",
    "llm",
    "agent",
    "skill",
    "tool",
    "router",
    "map",
    "join",
    "human",
    "subworkflow",
    "wait",
}


def _simple() -> Spec:
    nodes: list[JsonValue] = [trigger(), tool("a", "echo", value=1)]
    return draft(nodes, [edge("start", "a")])


def _make(api: Api, prefix: str) -> str:
    wid = unique(prefix)
    api.post("/workflows", {"id": wid, "name": "n"})
    return wid


def test_health_reports_ok_without_a_token(api: Api) -> None:
    response = api.send("GET", "/health", headers={})
    assert response.status == 200
    assert dig(response.body, "status") == "ok"
    assert dig(response.body, "app_version") == "test"
    assert isinstance(dig(response.body, "worker", "alive"), bool)


def test_nodes_catalog_lists_every_kind_tool_and_queue(api: Api) -> None:
    body = api.get("/nodes").body
    kinds = dig(body, "kinds")
    tools = dig(body, "tools")
    assert isinstance(kinds, list)
    assert isinstance(tools, list)
    assert {str(dig(item, "kind")) for item in kinds} == KINDS
    assert all(dig(item, "json_schema", "properties") for item in kinds)
    assert {"echo", "count", "effect"} <= {str(dig(item, "name")) for item in tools}
    assert dig(body, "queues", "local-gpu", "global_concurrency") == 1
    assert dig(body, "queues", "cloud-io", "global_concurrency") == 8
    assert dig(body, "queues", "host-browser", "global_concurrency") == 2


def test_write_routes_refuse_a_missing_or_wrong_token(api: Api) -> None:
    body: Spec = {"id": unique("auth"), "name": "n"}
    bad = {"Authorization": "Bearer wrong-token-value"}
    assert api.send("POST", "/workflows", body, headers={}).status == 401
    assert api.send("POST", "/workflows", body, headers=bad).status == 401
    assert api.send("POST", "/workflows", body, headers={"Authorization": TOKEN}).status == 401
    assert api.send("POST", "/workflows", body, headers=AUTH).status == 201


def test_workflow_crud_round_trip(api: Api) -> None:
    wid = unique("crud")
    assert api.post("/workflows", {"id": wid, "name": "first"}).status == 201
    assert api.post("/workflows", {"id": wid, "name": "x"}).status == 409
    assert dig(api.patch(f"/workflows/{wid}", {"name": "second"}).body, "name") == "second"
    listed = api.get("/workflows").body
    assert isinstance(listed, list)
    assert wid in {str(dig(item, "id")) for item in listed}
    assert api.delete(f"/workflows/{wid}").status == 204
    assert api.get(f"/workflows/{wid}").status == 404


def test_bad_workflow_id_is_refused(api: Api) -> None:
    assert api.post("/workflows", {"id": "bad id!", "name": "n"}).status == 422


def test_saved_versions_are_immutable_and_numbered(api: Api) -> None:
    wid = _make(api, "ver")
    first = api.post(f"/workflows/{wid}/versions", _simple()).body
    other_nodes: list[JsonValue] = [trigger(), tool("b", "echo", value=2)]
    other = draft(other_nodes, [edge("start", "b")])
    second = api.post(f"/workflows/{wid}/versions", other).body
    assert (dig(first, "version"), dig(second, "version")) == (1, 2)
    assert api.get(f"/workflows/{wid}/versions/1").body == first
    versions = api.get(f"/workflows/{wid}/versions").body
    assert isinstance(versions, list)
    assert [dig(item, "version") for item in versions] == [1, 2]
    assert dig(api.get(f"/workflows/{wid}").body, "latest_version") == 2
    assert api.get(f"/workflows/{wid}/versions/9").status == 404
    assert api.send("PUT", f"/workflows/{wid}/versions/1", other).status == 405


def test_validate_route_returns_every_issue(api: Api) -> None:
    nodes: list[JsonValue] = [trigger(), tool("a", "nope"), tool("orphan", "echo")]
    spec = draft(nodes, [edge("start", "a")])
    body = api.post("/validate", {"draft": spec}).body
    issues = dig(body, "issues")
    assert isinstance(issues, list)
    assert dig(body, "valid") is False
    assert {"unknown_tool", "unreachable"} <= {str(dig(issue, "code")) for issue in issues}


def test_invalid_version_is_refused_with_issues(api: Api) -> None:
    wid = _make(api, "inv")
    spec = draft([trigger()], [edge("start", "ghost")])
    response = api.post(f"/workflows/{wid}/versions", spec)
    assert response.status == 422
    assert dig(response.body, "issues", 0, "code") == "dangling_edge"


def test_version_with_unknown_child_workflow_is_refused(api: Api) -> None:
    wid = _make(api, "ref")
    node: Spec = {"id": "m", "kind": "subworkflow", "workflow_id": "missing", "version": 1}
    spec = draft([trigger(), node], [edge("start", "m")])
    response = api.post(f"/workflows/{wid}/versions", spec)
    assert dig(response.body, "issues", 0, "code") == "unknown_workflow"


def test_run_routes_report_unknown_ids(api: Api) -> None:
    assert api.get("/runs/none").status == 404
    assert api.get("/runs/none/events").status == 404
    assert api.post("/runs/none/cancel").status == 404
    assert api.post("/workflows/none/runs", {}).status == 404


def test_start_run_with_unknown_trigger_node_is_not_found(api: Api) -> None:
    wid = _make(api, "trg")
    api.post(f"/workflows/{wid}/versions", _simple())
    assert api.post(f"/workflows/{wid}/runs", {"trigger_node": "a"}).status == 404


def test_list_runs_filters_by_workflow(api: Api) -> None:
    wid = _make(api, "list")
    api.post(f"/workflows/{wid}/versions", _simple())
    api.post(f"/workflows/{wid}/runs", {})
    runs = api.get("/runs", workflow_id=wid).body
    assert isinstance(runs, list)
    assert len(runs) == 1
    assert dig(runs, 0, "version") == 1


def test_oversized_body_is_refused_with_413(api: Api) -> None:
    big: Spec = {"id": unique("big"), "name": "x" * 1_100_000}
    assert api.post("/workflows", big).status == 413


def test_cors_allows_loopback_origins_only(client: TestClient) -> None:
    local = client.get("/health", headers={"Origin": "http://localhost:3000"})
    other = client.get("/health", headers={"Origin": "https://example.com"})
    assert local.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in other.headers
