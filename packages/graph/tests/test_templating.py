"""Prompt templates replace placeholders with run data."""

from pydantic import JsonValue
from sosho_graph.templating import render_template


def test_render_replaces_flat_and_nested_keys() -> None:
    data: dict[str, JsonValue] = {"topic": "rivers", "memo": {"title": "Notes"}}
    assert render_template("{{topic}} / {{memo.title}}", data) == "rivers / Notes"


def test_render_missing_key_becomes_empty_text() -> None:
    assert render_template("a[{{absent}}]b", {}) == "a[]b"


def test_render_structured_value_becomes_indented_json() -> None:
    assert render_template("{{items}}", {"items": [1, "two"]}) == '[\n  1,\n  "two"\n]'
