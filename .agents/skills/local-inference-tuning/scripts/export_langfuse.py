#!/usr/bin/env python3
"""Export recorded LLM requests from a Langfuse ClickHouse into replay files.

Usage:
  export_langfuse.py list   --model openai/Qwen3.6-35B-A3B
  export_langfuse.py export --model openai/Qwen3.6-35B-A3B --campaign NAME \
      --group S1=0bca8db5 --group S2=fa44fc93 --singles W1=40

A group is the calls that share the first two messages, in time order.
`--singles W1=40` writes 40 seeded-random single-call groups into one file.
"""

import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lit.common import campaign_dir  # noqa: E402

QUERY = """SELECT start_time, input, usage_details['input'] AS new_input,
 usage_details['cache_read_input_tokens'] AS cache_read, usage_details['output'] AS output_tokens,
 dateDiff('millisecond', start_time, completion_start_time) AS ttft_ms,
 dateDiff('millisecond', start_time, end_time) AS dur_ms, model_parameters
FROM events_full WHERE type = 'GENERATION' AND provided_model_name = '{model}'
ORDER BY start_time FORMAT JSONEachRow"""

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\b(?:hf|ghp|gho|ghs|github_pat|glpat|xox[abpr])_[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
]
KEYED = re.compile(r"(?i)((?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)[\"'\s]*[:=][\"'\s]*)([^\s\"',]{8,})")


def redact(text: str) -> tuple[str, int]:
    count = 0
    for pat in SECRET_PATTERNS:
        text, n = pat.subn("[REDACTED]", text)
        count += n
    text, n = KEYED.subn(lambda m: m.group(1) + "[REDACTED]", text)
    return text, count + n


def fetch(container: str, model: str) -> list[dict]:
    cmd = ["docker", "exec", "-i", container, "sh", "-c",
           'clickhouse-client --user "${CLICKHOUSE_USER:-default}" --password "${CLICKHOUSE_PASSWORD:-}"']
    out = subprocess.run(cmd, input=QUERY.format(model=model), capture_output=True, text=True, check=True)
    rows = []
    for line in out.stdout.splitlines():
        row = json.loads(line)
        try:
            body = json.loads(row["input"])
        except json.JSONDecodeError:
            continue
        if not isinstance(body, dict) or "messages" not in body:
            continue
        row["body"] = body
        row["group"] = hashlib.md5(json.dumps(body["messages"][:2], sort_keys=True).encode()).hexdigest()[:8]
        rows.append(row)
    return rows


def to_turn(i: int, row: dict) -> dict:
    params = {}
    try:
        params = json.loads(row.get("model_parameters") or "{}")
    except json.JSONDecodeError:
        pass
    return {
        "i": i,
        "messages": row["body"]["messages"],
        "tools": row["body"].get("tools") or [],
        "reasoning_effort": params.get("reasoning_effort"),
        "recorded": {k: row.get(k) for k in ("start_time", "new_input", "cache_read", "output_tokens", "ttft_ms", "dur_ms")},
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
    ap.add_argument("--model", required=True)
    ap.add_argument("--container", default="sosho-clickhouse-1")
    ap.add_argument("--campaign")
    ap.add_argument("--group", action="append", default=[], help="NAME=hash")
    ap.add_argument("--singles", help="NAME=count")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    rows = fetch(a.container, a.model)
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)

    if a.action == "list":
        for g, rs in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:25]:
            print(g, len(rs), "calls", rs[0]["start_time"][:16], "->", rs[-1]["start_time"][:16],
                  "msgs", len(rs[0]["body"]["messages"]), "->", len(rs[-1]["body"]["messages"]))
        return

    out_dir = campaign_dir(a.campaign) / "replays"
    out_dir.mkdir(exist_ok=True)
    for spec in a.group:
        name, g = spec.split("=")
        turns = [to_turn(i, r) for i, r in enumerate(groups[g])]
        n = write(out_dir / f"{name}.jsonl", turns)
        print(f"{name}: {len(turns)} turns, {n} redactions")
    if a.singles:
        name, count = a.singles.split("=")
        singles = [rs[0] for rs in groups.values() if len(rs) == 1 and rs[0]["body"].get("tools")]
        random.Random(a.seed).shuffle(singles)
        turns = [to_turn(i, r) for i, r in enumerate(singles[: int(count)])]
        n = write(out_dir / f"{name}.jsonl", turns)
        print(f"{name}: {len(turns)} single calls of {len(singles)}, {n} redactions")


if __name__ == "__main__":
    main()
