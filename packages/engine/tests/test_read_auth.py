import pytest
from engine_support import Api
from flows import Spec, draft, edge, tool, trigger

READ_ROUTES = [
    ("GET", "/runs"),
    ("GET", "/runs/none"),
    ("GET", "/runs/none/events"),
    ("GET", "/schedules"),
    ("GET", "/workflows"),
    ("GET", "/workflows/none"),
    ("GET", "/workflows/none/versions"),
    ("GET", "/workflows/none/versions/1"),
    ("GET", "/nodes"),
    ("POST", "/validate"),
]


@pytest.mark.parametrize(("method", "path"), READ_ROUTES)
def test_every_route_but_health_and_webhook_needs_the_bearer_token(
    api: Api, method: str, path: str
) -> None:
    body: Spec = {"draft": draft([trigger(), tool("a", "echo", value=1)], [edge("start", "a")])}
    assert api.send(method, path, body, headers={}).status == 401
    wrong = {"Authorization": "Bearer wrong-token-value"}
    assert api.send(method, path, body, headers=wrong).status == 401


def test_health_and_the_webhook_route_stay_open(api: Api) -> None:
    assert api.send("GET", "/health", headers={}).status == 200
    hook = api.send("POST", "/webhooks/none/start", {}, {"X-Sosho-Token": "x"})
    assert hook.status == 404
