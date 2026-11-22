"""Prompt templates. Port of the TypeScript renderTemplate in activities.ts."""

import json
import re
from collections.abc import Mapping

from pydantic import JsonValue

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


def resolve_path(data: Mapping[str, JsonValue], path: str) -> object:
    """Return the value at a flat key or a dotted path. Return None when missing."""
    if path in data:
        return data[path]
    current: object = data
    for part in path.split("."):
        if not isinstance(current, Mapping):
            return None
        current = current.get(part)
    return current


def render_template(template: str, data: Mapping[str, JsonValue]) -> str:
    """Replace each placeholder with its value. Missing values become empty text."""

    def replace(match: re.Match[str]) -> str:
        value = resolve_path(data, match.group(1))
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return json.dumps(value, indent=2)

    return _PLACEHOLDER.sub(replace, template)
