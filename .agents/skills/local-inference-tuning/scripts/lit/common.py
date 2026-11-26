"""Shared helpers: paths, ledger, environment snapshot, streaming chat client."""

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2]
SCRIPTS = SKILL / "scripts"


def campaign_dir(name: str) -> Path:
    path = SKILL / "campaigns" / name
    if not path.is_dir():
        raise SystemExit(f"campaign not found: {path}")
    return path


def append_ledger(campaign: Path, record: dict) -> None:
    record = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), **record}
    with open(campaign / "ledger.jsonl", "a") as f:
        f.write(json.dumps(record) + "\n")


def env_snapshot() -> dict:
    out = subprocess.run(
        ["python3", "-I", str(SCRIPTS / "env_check.py")], capture_output=True, text=True, check=False
    )
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return {"error": out.stderr.strip()[:300]}


def http_json(url: str, body: dict | None = None, timeout: float = 30) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def stream_chat(base_url: str, body: dict, timeout: float = 1800) -> dict:
    """Send one streaming chat request. Return timing, usage, and text."""
    body = {**body, "stream": True, "stream_options": {"include_usage": True}}
    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    t_first = None
    usage, timings, finish = {}, {}, None
    text, reasoning, tool_args = [], [], []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                chunk = json.loads(payload)
                usage = chunk.get("usage") or usage
                timings = chunk.get("timings") or timings
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    got = False
                    for key, sink in (("content", text), ("reasoning_content", reasoning), ("reasoning", reasoning)):
                        if delta.get(key):
                            sink.append(delta[key])
                            got = True
                    for call in delta.get("tool_calls") or []:
                        fn = call.get("function") or {}
                        tool_args.append((fn.get("name") or "") + (fn.get("arguments") or ""))
                        got = True
                    if got and t_first is None:
                        t_first = time.perf_counter()
                    finish = choice.get("finish_reason") or finish
    except Exception as e:  # noqa: BLE001 - the caller records the failure
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
    t_end = time.perf_counter()
    if t_first is None:
        t_first = t_end
    details = usage.get("prompt_tokens_details") or {}
    out_tokens = usage.get("completion_tokens") or 0
    decode_s = t_end - t_first
    return {
        "ok": bool(usage),
        "error": None if usage else "no usage in stream",
        "ttft_s": t_first - t0,
        "total_s": t_end - t0,
        "decode_s": decode_s,
        "prompt_tokens": usage.get("prompt_tokens") or 0,
        "cached_tokens": details.get("cached_tokens") or 0,
        "output_tokens": out_tokens,
        "decode_tps": (out_tokens - 1) / decode_s if out_tokens > 1 and decode_s > 0 else None,
        "finish": finish,
        "timings": timings,
        "text": "".join(text),
        "reasoning": "".join(reasoning),
        "tool_text": "".join(tool_args),
    }


def looping(text: str, n: int = 8) -> bool:
    """True if most word 8-grams repeat. Marks a model stuck in a loop."""
    words = text.split()
    if len(words) < 4 * n:
        return False
    grams = [tuple(words[i : i + n]) for i in range(len(words) - n + 1)]
    return 1 - len(set(grams)) / len(grams) > 0.5


def median(values: list[float]) -> float | None:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2


def load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def nonce() -> str:
    return os.urandom(4).hex()
