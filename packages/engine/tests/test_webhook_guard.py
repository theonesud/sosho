from engine_support import Api, dig, publish
from flows import Spec, draft, edge, tool, trigger, unique
from pydantic import JsonValue
from sosho_engine.ratelimit import RateLimiter


def _hook_spec() -> Spec:
    nodes: list[JsonValue] = [trigger(mode="webhook"), tool("a", "echo", value="{{input.msg}}")]
    return draft(nodes, [edge("start", "a")])


def _token(api: Api, wid: str) -> str:
    return str(dig(api.get(f"/workflows/{wid}/triggers").body, "webhooks", 0, "token"))


def test_unknown_webhook_and_wrong_token_give_the_same_status(api: Api) -> None:
    wid = unique("samestatus")
    publish(api, _hook_spec(), wid)
    _token(api, wid)
    unknown = api.post_as("/webhooks/nothere/start", {}, {"X-Sosho-Token": "nope"})
    wrong = api.post_as(f"/webhooks/{wid}/start", {}, {"X-Sosho-Token": "nope"})
    assert unknown.status == wrong.status == 404
    assert unknown.body == wrong.body


def test_invalid_json_body_is_a_bad_request(api: Api) -> None:
    wid = unique("badjson")
    publish(api, _hook_spec(), wid)
    token = _token(api, wid)
    response = api.post_raw(f"/webhooks/{wid}/start", b"{not json", {"X-Sosho-Token": token})
    assert response.status == 400


def test_a_trigger_refuses_requests_above_its_rate_limit(api: Api) -> None:
    wid = unique("rate")
    publish(api, _hook_spec(), wid)
    token = _token(api, wid)
    statuses = [
        api.post_as(f"/webhooks/{wid}/start", {"msg": "x"}, {"X-Sosho-Token": token}).status
        for _ in range(61)
    ]
    assert statuses[0] == 202
    assert statuses[-1] == 429


def test_rate_limiter_frees_slots_after_the_window() -> None:
    now = [0.0]
    limiter = RateLimiter(2, 60.0, lambda: now[0])
    assert [limiter.allow("k"), limiter.allow("k"), limiter.allow("k")] == [True, True, False]
    assert limiter.allow("other")
    now[0] = 61.0
    assert limiter.allow("k")
