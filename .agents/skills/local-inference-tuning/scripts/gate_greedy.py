#!/usr/bin/env python3
"""G0 and G2: greedy outputs of a fixed prompt set, and agreement between two runs.

  gate_greedy.py run --base-url URL --campaign C --model M --out NAME
  gate_greedy.py compare --campaign C REF_NAME OTHER_NAME

`run` writes campaigns/C/gates/NAME.json. `compare` prints, per prompt, the
position of the first differing token, and the share of tokens that agree up
to there. Greedy texts of two correct engines split at near-ties, so the gate
counts the prompts that agree over a long prefix (half the text, or at least
120 characters), and the mean agreed share. It does not require exact equality.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_server import PANEL  # noqa: E402
from lit.common import campaign_dir, http_json, stream_chat  # noqa: E402

MAX_TOKENS = 64
GREEDY = {"temperature": 0.0, "top_k": 1, "top_p": 1.0}


def prompts(camp: Path) -> list[dict]:
    out = [{"id": f"panel{i}", "messages": [{"role": "user", "content": p}]} for i, p in enumerate(PANEL)]
    s1 = [json.loads(line) for line in open(camp / "replays" / "S1.jsonl")]
    for i in (0, 12, 24, len(s1) - 1):
        out.append({"id": f"S1t{i}", "messages": s1[i]["messages"], "tools": s1[i]["tools"]})
    w1 = [json.loads(line) for line in open(camp / "replays" / "W1.jsonl")]
    for i in (0, 1):
        out.append({"id": f"W1c{i}", "messages": w1[i]["messages"], "tools": w1[i]["tools"]})
    return out


def run(base_url: str, model: str, camp: Path, name: str) -> None:
    results = []
    for p in prompts(camp):
        body = {"model": model, "messages": p["messages"], "max_tokens": MAX_TOKENS, **GREEDY}
        if p.get("tools"):
            body["tools"] = p["tools"]
        r = stream_chat(base_url, body)
        text = r.get("reasoning", "") + "\x1f" + r.get("text", "") + "\x1f" + r.get("tool_text", "")
        results.append({"id": p["id"], "ok": r.get("ok"), "error": r.get("error"), "text": text,
                        "prompt_tokens": r.get("prompt_tokens")})
        print(p["id"], "ok" if r.get("ok") else r.get("error"), flush=True)
    for res in results:
        try:
            res["tokens"] = http_json(f"{base_url}/tokenize", {"content": res["text"]})["tokens"]
        except Exception:  # noqa: BLE001 - engines without /tokenize: fall back to words
            res["tokens"] = res["text"].split()
    out = camp / "gates"
    out.mkdir(exist_ok=True)
    (out / f"{name}.json").write_text(json.dumps(results, indent=1))


def first_diff(a: list[str], b: list[str]) -> int:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def compare(camp: Path, ref: str, other: str) -> None:
    a = {r["id"]: r for r in json.load(open(camp / "gates" / f"{ref}.json"))}
    b = {r["id"]: r for r in json.load(open(camp / "gates" / f"{other}.json"))}
    rows, agree32, lens = [], 0, []
    for pid in a:
        # Compare characters: token ids differ between engines with different tokenizer endpoints.
        ta, tb = a[pid]["text"], b[pid]["text"]
        n = first_diff(list(ta), list(tb))
        full = min(len(ta), len(tb))
        share = n / full if full else 1.0
        lens.append(share)
        agree32 += share >= 0.5 or n >= 120
        rows.append((pid, n, full, round(share, 2)))
    for r in rows:
        print(f"{r[0]:8} first diff at char {r[1]:4} of {r[2]:4}  share {r[3]}")
    print(json.dumps({"ref": ref, "other": other, "prompts": len(rows),
                      "agree_long_prefix": agree32, "mean_share": round(sum(lens) / len(lens), 3)}))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--base-url", required=True)
    r.add_argument("--campaign", required=True)
    r.add_argument("--model", required=True)
    r.add_argument("--out", required=True)
    c = sub.add_parser("compare")
    c.add_argument("--campaign", required=True)
    c.add_argument("ref")
    c.add_argument("other")
    a = ap.parse_args()
    camp = campaign_dir(a.campaign)
    if a.cmd == "run":
        run(a.base_url, a.model, camp, a.out)
    else:
        compare(camp, a.ref, a.other)


if __name__ == "__main__":
    main()
