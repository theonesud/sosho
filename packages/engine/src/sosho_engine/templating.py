import json
import re
from collections.abc import Mapping, Sequence

from pydantic import JsonValue

PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")
NODE_REF = re.compile(r"^nodes\.([A-Za-z][A-Za-z0-9_-]*)")


def resolve_path(data: Mapping[str, JsonValue], path: str) -> JsonValue:
    current: JsonValue = dict(data)
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return current


def _as_text(value: JsonValue) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, indent=2, sort_keys=True)


def render_template(template: str, data: Mapping[str, JsonValue]) -> str:
    return PLACEHOLDER.sub(lambda match: _as_text(resolve_path(data, match.group(1))), template)


def render_value(value: JsonValue, data: Mapping[str, JsonValue]) -> JsonValue:
    if isinstance(value, str):
        whole = PLACEHOLDER.fullmatch(value.strip())
        if whole is not None:
            return resolve_path(data, whole.group(1))
        return render_template(value, data)
    if isinstance(value, list):
        return [render_value(item, data) for item in value]
    if isinstance(value, dict):
        return {key: render_value(item, data) for key, item in value.items()}
    return value


def template_paths(value: JsonValue) -> list[str]:
    if isinstance(value, str):
        return PLACEHOLDER.findall(value)
    if isinstance(value, Sequence) and not isinstance(value, str):
        return [path for item in value for path in template_paths(item)]
    if isinstance(value, dict):
        return [path for item in value.values() for path in template_paths(item)]
    return []


def referenced_nodes(paths: Sequence[str]) -> set[str]:
    refs: set[str] = set()
    for path in paths:
        match = NODE_REF.match(path)
        if match is not None:
            refs.add(match.group(1))
    return refs
