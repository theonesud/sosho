from itertools import count

from pydantic import JsonValue

Spec = dict[str, JsonValue]
_ids = count(1)


def unique(prefix: str) -> str:
    return f"{prefix}{next(_ids)}"


def trigger(node_id: str = "start", **extra: JsonValue) -> Spec:
    return {"id": node_id, "kind": "trigger", **extra}


def tool(node_id: str, name: str, **args: JsonValue) -> Spec:
    return {"id": node_id, "kind": "tool", "tool": name, "args": args}


def llm(node_id: str, prompt: str, role: str = "fast", **extra: JsonValue) -> Spec:
    return {"id": node_id, "kind": "llm", "role": role, "prompt": prompt, **extra}


def edge(source: str, target: str, when: str | None = None, **extra: JsonValue) -> Spec:
    body: Spec = {"source": source, "target": target, **extra}
    if when is not None:
        body["when"] = when
    return body


def draft(nodes: list[JsonValue], edges: list[JsonValue], **extra: JsonValue) -> Spec:
    return {"name": "test flow", "nodes": nodes, "edges": edges, "entry": "start", **extra}
