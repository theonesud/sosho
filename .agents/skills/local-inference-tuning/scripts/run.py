#!/usr/bin/env python3
"""Run configs of a campaign in order and write the ledger.

  run.py --campaign NAME queue b0 a04-threads5 b0 --levels M3,M2
  run.py --campaign NAME serve b0          start a config and leave it running
  run.py --campaign NAME stop              stop the engine container

The settings come from campaigns/NAME/campaign.json, the configs from campaigns/NAME/configs/*.json.
"""

import argparse
import fcntl
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_server import run_m2  # noqa: E402
from lit.common import append_ledger, campaign_dir, env_snapshot, load_json, nonce  # noqa: E402
from replay import run_replay  # noqa: E402

LOCK = "/tmp/local-inference-tuning.lock"
NAME = "lit-engine"


def docker(*args: str, check: bool = True) -> str:
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=check).stdout.strip()


def stop_engine() -> None:
    if docker("ps", "-aq", "-f", f"name=^{NAME}$", check=False):
        docker("stop", "-t", "60", NAME, check=False)
        docker("rm", "-f", NAME, check=False)


def start_engine(camp: Path, s: dict, cfg: dict) -> tuple[float, Path]:
    stop_engine()
    if cfg.get("cache", "fresh") == "fresh":
        cache = camp / "cache" / f"fresh-{nonce()}"
    else:
        cache = camp / "cache" / cfg["cache"]
    cache.mkdir(parents=True, exist_ok=True)
    env = {"STRATA_NO_UPDATE_CHECK": "1", **cfg.get("env", {})}
    cmd = ["run", "-d", "--name", NAME, "--gpus", "all", "--ipc", "host", "--ulimit", "memlock=-1",
           "--user", f"{s['uid']}:{s['gid']}", "-p", f"127.0.0.1:{s['port']}:8080",
           "-v", f"{s['models_dir']}:/models:ro", "-v", f"{cache}:/cache"]
    for k, v in env.items():
        cmd += ["-e", f"{k}={v}"]
    cmd += cfg.get("docker_args", [])
    if "command" in cfg:
        # Another engine: the full command after the image. {model} is the model path in the container.
        cmd += [cfg["image"], *[a.replace("{model}", f"/models/{s['model_file']}") for a in cfg["command"]]]
    else:
        cmd += [cfg.get("image", s["image"]), "serve", "--model", f"/models/{s['model_file']}", "--addr", "0.0.0.0:8080",
                *cfg["serve_args"]]
    t0 = time.perf_counter()
    docker(*cmd)
    url = f"http://127.0.0.1:{s['port']}/health"
    while time.perf_counter() - t0 < s.get("health_timeout_s", 900):
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return time.perf_counter() - t0, cache
        except Exception:  # noqa: BLE001 - not ready yet
            pass
        if not docker("ps", "-q", "-f", f"name=^{NAME}$", check=False):
            break
        time.sleep(2)
    raise RuntimeError("engine did not become healthy:\n" + docker("logs", "--tail", "30", NAME, check=False))


def warm_up(base: str, model: str, sampling: dict) -> None:
    body = {"model": model, "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
            "max_tokens": 16, **sampling}
    req = urllib.request.Request(f"{base}/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        r.read()


def env_changed(before: dict, after: dict) -> bool:
    gb, ga = before.get("gpu", {}), after.get("gpu", {})
    return (before.get("load_profile") != after.get("load_profile")
            or sorted(c for c in before.get("containers", []) if c != NAME)
            != sorted(c for c in after.get("containers", []) if c != NAME)
            or abs(after.get("cpu_busy_pct", 0) - before.get("cpu_busy_pct", 0)) > 15
            or not isinstance(gb.get("mem_used_mib"), int) or not isinstance(ga.get("mem_used_mib"), int))


def run_one(camp: Path, s: dict, cfg_name: str, role: str, prof_name: str) -> dict:
    prof = s["profiles"][prof_name]
    cfg = load_json(camp / "configs" / f"{cfg_name}.json")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    runs = camp / "runs"
    runs.mkdir(exist_ok=True)
    env_before = env_snapshot()
    startup_s, cache = start_engine(camp, s, cfg)
    base = f"http://127.0.0.1:{s['port']}"
    model = s["request_model"]
    common = {"config": cfg_name, "role": role, "profile": prof_name, "startup_s": round(startup_s, 1),
              "env_before": env_before}
    score = {"config": cfg_name, "role": role, "startup_s": round(startup_s, 1)}
    try:
        warm_up(base, model, s["sampling"])
        env_loaded = env_snapshot()
        if prof.get("m3"):
            for session, limit in prof["m3"]["replays"].items():
                out = run_replay(base, model, camp / "replays" / f"{session}.jsonl", prof["m3"]["reps"],
                                 s["sampling"], limit)
                score[session] = out["summary"]["replay_s"]
                score[f"{session}_hit"] = out["summary"]["cache_hit"]
                score[f"{session}_dec"] = out["summary"]["decode_med"]
                (runs / f"{stamp}_{cfg_name}_{session}.json").write_text(json.dumps(out))
                flags = ["REQ_FAIL"] * bool(out["summary"]["failed"]) + ["LOOP"] * bool(out["summary"]["loops"])
                append_ledger(camp, {**common, "level": "M3", **out["summary"], "env_loaded": env_loaded,
                                     "flags": flags, "ok": not flags})
        if prof.get("m2"):
            m2 = prof["m2"]
            out = run_m2(base, model, camp, s["sampling"], s["ctx"], m2["decode_samples"], tuple(m2["prefill"]),
                         m2.get("needle", False), m2["prefill_reps"])
            score["short_ttft"] = out["short_ttft_s"]
            score["decode"] = out["decode_med"]
            for p in out["prefill"]:
                score[f"pp{p['tokens']}"] = p["prefill_med"]
            if out.get("needle"):
                score["needle"] = [n["found"] for n in out["needle"]]
            (runs / f"{stamp}_{cfg_name}_M2.json").write_text(json.dumps(out))
            flags = ["REQ_FAIL"] * bool(out["failed"]) + ["LOOP"] * bool(out["loops"])
            append_ledger(camp, {**common, "level": "M2", **out, "env_loaded": env_loaded,
                                 "flags": flags, "ok": not flags})
        env_after = env_snapshot()
        if env_changed(env_before, env_after):
            append_ledger(camp, {**common, "level": "ENV", "flags": ["ENV_CHANGED"], "env_after": env_after,
                                 "ok": False})
            score["env_changed"] = True
        score["score_s"] = round(sum(score[k] for k in prof.get("m3", {}).get("replays", {}) if score.get(k)), 2)
        return score
    finally:
        logs = subprocess.run(["docker", "logs", NAME], capture_output=True, text=True, check=False)
        (runs / f"{stamp}_{cfg_name}.log").write_text(logs.stdout + logs.stderr)
        stop_engine()
        if cfg.get("cache", "fresh") == "fresh":
            shutil.rmtree(cache, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("queue")
    q.add_argument("configs", nargs="+")
    q.add_argument("--profile", default="quick")
    q.add_argument("--roles", help="comma list, default: the first config and its repeats are controls")
    sv = sub.add_parser("serve")
    sv.add_argument("config")
    sub.add_parser("stop")
    a = ap.parse_args()
    camp = campaign_dir(a.campaign)
    s = load_json(camp / "campaign.json")

    if a.cmd == "stop":
        stop_engine()
        return
    with open(LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        stopped = [c for c in s.get("stop_containers", []) if docker("ps", "-q", "-f", f"name=^{c}$", check=False)]
        for c in stopped:
            docker("stop", "-t", "60", c, check=False)
        try:
            if a.cmd == "serve":
                startup_s, _ = start_engine(camp, s, load_json(camp / "configs" / f"{a.config}.json"))
                print(f"healthy after {startup_s:.1f} s on port {s['port']}. Stop with: run.py --campaign {a.campaign} stop")
                print(f"left stopped for VRAM: {', '.join(stopped) or 'none'}. Start them again after the stop.")
                stopped = []
                return
            roles = a.roles.split(",") if a.roles else ["control" if c == a.configs[0] else "candidate" for c in a.configs]
            table = []
            for cfg_name, role in zip(a.configs, roles):
                print(f"== {time.strftime('%H:%M:%S')} {cfg_name} ({role})", flush=True)
                try:
                    sc = run_one(camp, s, cfg_name, role, a.profile)
                except Exception as e:  # noqa: BLE001 - record and go on with the queue
                    sc = {"config": cfg_name, "role": role, "error": str(e)[:300]}
                    append_ledger(camp, {"config": cfg_name, "role": role, "profile": a.profile, "level": "START",
                                         "flags": ["START_FAIL"], "error": str(e)[:2000], "ok": False})
                print(json.dumps(sc), flush=True)
                table.append(sc)
            (camp / "runs" / f"{time.strftime('%Y%m%d-%H%M%S')}_queue.json").write_text(json.dumps(table, indent=1))
        finally:
            for c in stopped:
                docker("start", c, check=False)


if __name__ == "__main__":
    main()
