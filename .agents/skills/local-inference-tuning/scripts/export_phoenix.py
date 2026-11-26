#!/usr/bin/env python3
import argparse
import hashlib
import json
import random
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lit.common import campaign_dir  # noqa: E402

PAGE = 1000
MESSAGES_KEY = "gen_ai.input.messages"

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\b(?:hf|ghp|gho|ghs|github_pat|glpat|xox[abpr])_[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
]
KEYED = re.compile(
    r"(?i)((?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)[\"'\s]*[:=][\"'\s]*)([^\s\"',]{8,})"
)


def redact(text: str) -> tuple[str, int]:
    count = 0
    for pat in SECRET_PATTERNS:
        text, n = pat.subn("[REDACTED]", text)
        count += n
    text, n = KEYED.subn(lambda m: m.group(1) + "[REDACTED]", text)
    return text, count + n


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def fetch_spans(base_url: str, project: str, since: str | None) -> list[dict]:
    spans: list[dict] = []
    cursor = None
    while True:
        query = {"limit": PAGE}
        if since:
            query["start_time"] = since
        if cursor:
            query["cursor"] = cursor
        page = get_json(
            f"{base_url}/v1/projects/{urllib.parse.quote(project)}/spans?{urllib.parse.urlencode(query)}"
        )
        spans.extend(page["data"])
        cursor = page.get("next_cursor")
        if not cursor:
            return spans


def ms_between(start: str, end: str) -> int:
    return round(
        (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() * 1000
    )


def tools_from(attrs: dict) -> list[dict]:
    tools = []
    idx = 0
    while f"llm.tools.{idx}.tool.name" in attrs:
        function = {"name": attrs[f"llm.tools.{idx}.tool.name"]}
        description = attrs.get(f"llm.tools.{idx}.tool.description")
        if description is not None:
            function["description"] = description
        schema = attrs.get(f"llm.tools.{idx}.tool.json_schema")
        if schema:
            function["parameters"] = json.loads(schema)
        tools.append({"type": "function", "function": function})
        idx += 1
    return tools


def to_row(span: dict, sessions: dict[str, str]) -> dict | None:
    attrs = span.get("attributes", {})
    raw = attrs.get(MESSAGES_KEY)
    if not raw:
        return None
    try:
        messages = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(messages, list) or not messages:
        return None
    prompt = attrs.get("llm.token_count.prompt") or 0
    cache = attrs.get("llm.token_count.prompt_details.cache_read") or 0
    ttft = attrs.get("gen_ai.response.time_to_first_chunk")
    return {
        "start_time": span["start_time"],
        "messages": messages,
        "tools": tools_from(attrs),
        "model": attrs.get("llm.model_name"),
        "upstream_model": attrs.get("litellm.provider.model"),
        "session": sessions.get(span["context"]["trace_id"]),
        "new_input": max(prompt - cache, 0),
        "cache_read": cache,
        "output_tokens": attrs.get("llm.token_count.completion"),
        "ttft_ms": round(ttft * 1000) if ttft is not None else None,
        "dur_ms": ms_between(span["start_time"], span["end_time"]),
        "group": hashlib.md5(json.dumps(messages[:2], sort_keys=True).encode()).hexdigest()[:8],
    }


def fetch(base_url: str, project: str, model: str, since: str | None) -> list[dict]:
    spans = fetch_spans(base_url, project, since)
    sessions = {}
    for s in spans:
        sid = s.get("attributes", {}).get("session.id")
        if sid:
            sessions[s["context"]["trace_id"]] = sid
    rows = []
    for s in spans:
        if s.get("span_kind") != "LLM" or not s.get("name", "").startswith("chat "):
            continue
        row = to_row(s, sessions)
        if row and model in (row["model"], row["upstream_model"]):
            rows.append(row)
    rows.sort(key=lambda r: r["start_time"])
    return rows


def to_turn(i: int, row: dict) -> dict:
    keys = ("start_time", "new_input", "cache_read", "output_tokens", "ttft_ms", "dur_ms")
    return {
        "i": i,
        "messages": row["messages"],
        "tools": row["tools"],
        "reasoning_effort": None,
        "recorded": {k: row[k] for k in keys},
    }


def write(path: Path, turns: list[dict]) -> int:
    total = 0
    with open(path, "w") as f:
        for t in turns:
            line, n = redact(json.dumps(t))
            total += n
            f.write(line + "\n")
    return total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["list", "export"])
    ap.add_argument("--model", required=True, help="LiteLLM model alias or upstream model name")
    ap.add_argument("--url", default="http://127.0.0.1:6006")
    ap.add_argument("--project", default="sosho")
    ap.add_argument("--since", help="ISO time, for example 2026-11-27T00:00:00Z")
    ap.add_argument("--campaign")
    ap.add_argument("--group", action="append", default=[], help="NAME=hash")
    ap.add_argument("--singles", help="NAME=count")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    rows = fetch(a.url, a.project, a.model, a.since)
    if not rows:
        raise SystemExit(
            f"no chat span with {MESSAGES_KEY} for model {a.model} in project {a.project}. "
            "LiteLLM needs OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only."
        )
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)

    if a.action == "list":
        for g, rs in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:25]:
            sessions = {r["session"] for r in rs if r["session"]}
            print(
                g,
                len(rs),
                "calls",
                rs[0]["start_time"][:16],
                "->",
                rs[-1]["start_time"][:16],
                "msgs",
                len(rs[0]["messages"]),
                "->",
                len(rs[-1]["messages"]),
                "sessions",
                len(sessions),
            )
        return

    if not a.campaign:
        raise SystemExit("export needs --campaign")
    out_dir = campaign_dir(a.campaign) / "replays"
    out_dir.mkdir(exist_ok=True)
    for spec in a.group:
        name, g = spec.split("=")
        turns = [to_turn(i, r) for i, r in enumerate(groups[g])]
        n = write(out_dir / f"{name}.jsonl", turns)
        print(f"{name}: {len(turns)} turns, {n} redactions")
    if a.singles:
        name, count = a.singles.split("=")
        singles = [rs[0] for rs in groups.values() if len(rs) == 1 and rs[0]["tools"]]
        random.Random(a.seed).shuffle(singles)
        turns = [to_turn(i, r) for i, r in enumerate(singles[: int(count)])]
        n = write(out_dir / f"{name}.jsonl", turns)
        print(f"{name}: {len(turns)} single calls of {len(singles)}, {n} redactions")


if __name__ == "__main__":
    main()
