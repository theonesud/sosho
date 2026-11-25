from collections.abc import Mapping

from pydantic import JsonValue

from sosho_engine.spec_nodes import Condition
from sosho_engine.templating import render_value, resolve_path


def _numbers(left: JsonValue, right: JsonValue) -> tuple[float, float] | None:
    numeric = (int, float)
    if isinstance(left, numeric) and isinstance(right, numeric):
        if isinstance(left, bool) or isinstance(right, bool):
            return None
        return float(left), float(right)
    return None


def _compare(op: str, left: JsonValue, right: JsonValue) -> bool:
    pair = _numbers(left, right)
    if pair is None:
        return False
    first, second = pair
    return {
        "gt": first > second,
        "gte": first >= second,
        "lt": first < second,
        "lte": first <= second,
    }[op]


def _contained(item: JsonValue, container: JsonValue) -> bool:
    if isinstance(container, list):
        return item in container
    if isinstance(container, str) and isinstance(item, str):
        return item in container
    return False


def evaluate(condition: Condition, data: Mapping[str, JsonValue]) -> bool:
    left = resolve_path(data, condition.path)
    right = render_value(condition.value, data)
    op = condition.op
    simple = {
        "eq": lambda: left == right,
        "ne": lambda: left != right,
        "truthy": lambda: bool(left),
        "exists": lambda: left is not None,
        "in": lambda: _contained(left, right),
        "contains": lambda: _contained(right, left),
    }
    if op in simple:
        return simple[op]()
    return _compare(op, left, right)
