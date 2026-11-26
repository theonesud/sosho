#!/usr/bin/env python3
"""M3: replay recorded agent requests against an OpenAI-compatible server.

Standalone use against a running server:
  replay.py --base-url http://127.0.0.1:8091 --campaign NAME --replay S1 --reps 3

Each rep puts a new nonce at the start of the first message of every request.
The first turn of each rep is then cold, and the turns inside a rep share a prefix.
"""

import argparse
import copy
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lit.common import campaign_dir, load_json, looping, median, nonce, stream_chat  # noqa: E402


def load_turns(path: Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def with_nonce(messages: list[dict], tag: str) -> list[dict]:
    msgs = copy.deepcopy(messages)
    first = msgs[0]
    prefix = f"[replay {tag}]\n"
    if isinstance(first.get("content"), str):
        first["content"] = prefix + first["content"]
    elif isinstance(first.get("content"), list) and first["content"] and first["content"][0].get("type") == "text":
        first["content"][0]["text"] = prefix + first["content"][0]["text"]
    else:
        msgs.insert(0, {"role": "system", "content": prefix})
    return msgs


def run_rep(base_url: str, model: str, turns: list[dict], sampling: dict) -> dict:
    tag = nonce()
    results = []
    t_start = time.perf_counter()
    for t in turns:
        rec_out = t["recorded"].get("output_tokens") or 0
        body = {"model": model, "messages": with_nonce(t["messages"], tag), "max_tokens": max(rec_out, 1), **sampling}
        if t.get("tools"):
            body["tools"] = t["tools"]
        r = stream_chat(base_url, body)
        r["i"] = t["i"]
        r["recorded_output_tokens"] = rec_out
        r["loop"] = r.get("ok", False) and looping(r.get("text", "") + " " + r.get("reasoning", ""))
        for k in ("text", "reasoning", "tool_text"):
            r.pop(k, None)
        results.append(r)
    wall = time.perf_counter() - t_start
    return summarize(results, wall)


def summarize(results: list[dict], wall: float) -> dict:
    ok = [r for r in results if r.get("ok")]
    med_tps = median([r["decode_tps"] for r in ok])
    replay_s, slowest = 0.0, (None, 0.0)
    for r in ok:
        tps = r["decode_tps"] or med_tps
        out_s = (r["recorded_output_tokens"] - 1) / tps if tps and r["recorded_output_tokens"] > 1 else 0.0
        turn_s = r["ttft_s"] + out_s
        replay_s += turn_s
        if turn_s > slowest[1]:
            slowest = (r["i"], turn_s)
    prompt = sum(r["prompt_tokens"] for r in ok)
    return {
        "replay_s": round(replay_s, 3),
        "wall_s": round(wall, 3),
        "ttft_sum_s": round(sum(r["ttft_s"] for r in ok), 3),
        "first_ttft_s": round(ok[0]["ttft_s"], 3) if ok else None,
        "decode_med": round(med_tps, 2) if med_tps else None,
        "cache_hit": round(sum(r["cached_tokens"] for r in ok) / prompt, 4) if prompt else None,
        "prompt_tokens": prompt,
        "output_tokens": sum(r["output_tokens"] for r in ok),
        "slowest_turn": {"i": slowest[0], "s": round(slowest[1], 3)},
        "turns": len(results),
        "failed": len(results) - len(ok),
        "loops": sum(1 for r in results if r.get("loop")),
        "errors": sorted({r["error"] for r in results if r.get("error")})[:3],
        "per_turn": results,
    }


def run_replay(base_url: str, model: str, replay_path: Path, reps: int, sampling: dict, limit: int = 0) -> dict:
    turns = load_turns(replay_path)
    if limit:
        turns = turns[:limit]
    reps_out = [run_rep(base_url, model, turns, sampling) for _ in range(reps)]
    keys = ("replay_s", "wall_s", "ttft_sum_s", "first_ttft_s", "decode_med", "cache_hit")
    summary = {k: median([r[k] for r in reps_out]) for k in keys}
    summary.update({
        "session": replay_path.stem,
        "reps": reps,
        "replay_s_all": [r["replay_s"] for r in reps_out],
        "failed": sum(r["failed"] for r in reps_out),
        "loops": sum(r["loops"] for r in reps_out),
        "errors": sorted({e for r in reps_out for e in r["errors"]})[:3],
    })
    return {"summary": summary, "reps": reps_out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--replay", action="append", required=True)
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--model")
    ap.add_argument("--limit", type=int, default=0, help="first N turns only, for smoke tests")
    a = ap.parse_args()
    camp = campaign_dir(a.campaign)
    settings = load_json(camp / "campaign.json")
    model = a.model or settings.get("request_model")
    for name in a.replay:
        out = run_replay(a.base_url, model, camp / "replays" / f"{name}.jsonl", a.reps, settings["sampling"], a.limit)
        print(json.dumps(out["summary"], indent=1))


if __name__ == "__main__":
    main()
