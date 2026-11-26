from itertools import count

from pydantic import JsonValue

Spec = dict[str, JsonValue]
PI_ROLE = "local-uncensored"
DIRECT_ROLE = "decision"
MISSING_ROLE = "no-such-role"
SHORT = "Reply with the single word ok."
LONG = "Write the whole numbers from 1 to 5000, one per line, with no other text."
_ids = count(1)


def unique(prefix: str) -> str:
    return f"{prefix}{next(_ids)}"


def trigger(node_id: str = "start", **extra: JsonValue) -> Spec:
    return {"id": node_id, "kind": "trigger", **extra}


def tool(node_id: str, name: str, **args: JsonValue) -> Spec:
    return {"id": node_id, "kind": "tool", "tool": name, "args": args}


def llm(node_id: str, prompt: str, role: str = DIRECT_ROLE, **extra: JsonValue) -> Spec:
    return {"id": node_id, "kind": "llm", "role": role, "prompt": prompt, **extra}


def edge(source: str, target: str, when: str | None = None, **extra: JsonValue) -> Spec:
    body: Spec = {"source": source, "target": target, **extra}
    if when is not None:
        body["when"] = when
    return body


def draft(nodes: list[JsonValue], edges: list[JsonValue], **extra: JsonValue) -> Spec:
    return {"name": "test flow", "nodes": nodes, "edges": edges, "entry": "start", **extra}
