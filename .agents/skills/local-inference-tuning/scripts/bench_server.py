#!/usr/bin/env python3
"""M2: server benchmark - short TTFT, single-request decode, cold prefill, needle.

Standalone use against a running server:
  bench_server.py --base-url http://127.0.0.1:8091 --campaign NAME [--needle]
"""

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lit.common import campaign_dir, http_json, load_json, looping, median, nonce, stream_chat  # noqa: E402

PANEL = [
    "Write a Python function that parses an ISO 8601 duration string into seconds. Include edge cases.",
    "Explain how a write-ahead log gives crash safety in a database. Use a short example.",
    "Write a bash script that finds the 10 largest files under a folder and prints them as a table.",
    "Review this idea: cache HTTP responses in Redis with a 5 minute TTL keyed by URL. List the risks.",
    "Write a TypeScript type-safe event emitter class with on, off, and emit methods.",
    "Describe the steps to debug a Docker container that exits right after start.",
]


def corpus(camp: Path) -> str:
    """Real agent text: system prompts and tool outputs from the replay files."""
    parts, seen = [], set()
    for path in sorted((camp / "replays").glob("*.jsonl")):
        for line in open(path):
            for m in json.loads(line)["messages"]:
                c = m.get("content")
                if isinstance(c, str) and len(c) > 200 and c not in seen:
                    seen.add(c)
                    parts.append(c)
    random.Random(7).shuffle(parts)
    return "\n\n".join(parts)


def count_tokens(base_url: str, text: str) -> int:
    try:
        return len(http_json(f"{base_url}/tokenize", {"content": text}, timeout=120)["tokens"])
    except Exception:  # noqa: BLE001 - engines without /tokenize
        return int(len(text) / 3.3)


def document(base_url: str, text: str, tokens: int) -> str:
    """Cut real text to about `tokens` tokens. Repeat it if it is too short."""
    while count_tokens(base_url, text[: 400_000]) < tokens and len(text) < 2_000_000:
        text = text + "\n\n" + text
    lo, hi = 0, len(text)
    while hi - lo > 200:
        mid = (lo + hi) // 2
        if count_tokens(base_url, text[:mid]) < tokens:
            lo = mid
        else:
            hi = mid
    return text[:lo]


def chat(base_url: str, model: str, prompt: str, max_tokens: int, sampling: dict) -> dict:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, **sampling}
    return stream_chat(base_url, body)


def short_ttft(base_url: str, model: str, sampling: dict, reps: int = 3) -> float | None:
    chat(base_url, model, "Reply with the single word: ready", 8, sampling)
    return median([chat(base_url, model, f"Reply with the single word: ready ({i})", 8, sampling)["ttft_s"] for i in range(reps)])


def decode(base_url: str, model: str, sampling: dict, samples: int) -> dict:
    rs = [chat(base_url, model, PANEL[i % len(PANEL)], 512, sampling) for i in range(samples)]
    ok = [r for r in rs if r.get("ok")]
    return {
        "decode_med": median([r["decode_tps"] for r in ok]),
        "decode_all": [round(r["decode_tps"], 2) for r in ok if r["decode_tps"]],
        "loops": sum(1 for r in ok if looping(r["text"] + " " + r["reasoning"])),
        "failed": len(rs) - len(ok),
    }


def prefill(base_url: str, model: str, sampling: dict, text: str, tokens: int, reps: int) -> dict:
    doc = document(base_url, text, tokens)
    vals = []
    for _ in range(reps):
        r = chat(base_url, model, f"[doc {nonce()}]\n{doc}\n\nSummarize the text above in one line.", 1, sampling)
        if r.get("ok") and r["ttft_s"] > 0:
            vals.append(r["prompt_tokens"] / r["ttft_s"])
    return {"tokens": tokens, "prefill_med": median(vals), "prefill_all": [round(v, 1) for v in vals]}


def needle(base_url: str, model: str, sampling: dict, text: str, tokens: int) -> dict:
    rng = random.Random(tokens)
    codes = {name: str(rng.randint(10000, 99999)) for name in ("amber", "cobalt", "violet")}
    doc = document(base_url, text, tokens)
    for frac, (name, code) in zip((0.1, 0.5, 0.9), codes.items()):
        cut = int(len(doc) * frac)
        doc = doc[:cut] + f"\nThe access code for the {name} door is {code}.\n" + doc[cut:]
    q = "List the access codes for the amber, cobalt, and violet doors from the text above."
    r = chat(base_url, model, f"[doc {nonce()}]\n{doc}\n\n{q}", 4096, sampling)
    out = r.get("text", "") + " " + r.get("reasoning", "")
    return {"tokens": tokens, "found": sum(c in out for c in codes.values()), "of": 3,
            "prompt_tokens": r.get("prompt_tokens"), "ok": r.get("ok"), "error": r.get("error")}


def run_m2(base_url: str, model: str, camp: Path, sampling: dict, ctx: int, samples: int = 6,
           prefill_sizes: tuple[int, ...] = (4096, 32768), with_needle: bool = False, prefill_reps: int = 3) -> dict:
    text = corpus(camp)
    out = {"short_ttft_s": short_ttft(base_url, model, sampling)}
    out.update(decode(base_url, model, sampling, samples))
    out["prefill"] = [prefill(base_url, model, sampling, text, n, prefill_reps) for n in prefill_sizes]
    if with_needle:
        out["needle"] = [needle(base_url, model, sampling, text, int(ctx * f) - 4096) for f in (0.5, 1.0)]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--model")
    ap.add_argument("--samples", type=int, default=6)
    ap.add_argument("--needle", action="store_true")
    ap.add_argument("--quick", action="store_true", help="1 decode sample, one 4K prefill: smoke test")
    a = ap.parse_args()
    camp = campaign_dir(a.campaign)
    s = load_json(camp / "campaign.json")
    sizes = (4096,) if a.quick else (4096, 32768)
    out = run_m2(a.base_url, a.model or s["request_model"], camp, s["sampling"], s["ctx"],
                 1 if a.quick else a.samples, sizes, with_needle=a.needle)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
