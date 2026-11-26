#!/usr/bin/env python3
"""Print one JSON object with the machine state that affects a run."""

import json
import os
import subprocess
import time


def sh(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def cpu_busy(seconds: float = 2.0) -> float:
    def read() -> tuple[int, int]:
        with open("/proc/stat") as f:
            vals = [int(x) for x in f.readline().split()[1:]]
        idle = vals[3] + vals[4]
        return idle, sum(vals)

    i0, t0 = read()
    time.sleep(seconds)
    i1, t1 = read()
    return round(100 * (1 - (i1 - i0) / max(t1 - t0, 1)), 1)


def gpu() -> dict:
    q = "memory.used,memory.total,utilization.gpu,temperature.gpu,pcie.link.gen.current,pcie.link.width.current,clocks.sm"
    row = sh(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"])
    keys = ["mem_used_mib", "mem_total_mib", "util_pct", "temp_c", "pcie_gen", "pcie_width", "sm_mhz"]
    vals = [v.strip() for v in row.split(",")] if row else []
    out = {k: (int(v) if v.isdigit() else v) for k, v in zip(keys, vals)}
    apps = sh(["nvidia-smi", "--query-compute-apps=process_name,used_memory", "--format=csv,noheader,nounits"])
    out["compute_apps"] = [a.strip() for a in apps.splitlines() if a.strip()]
    return out


def meminfo() -> dict:
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":")
            info[k] = int(v.split()[0]) // 1024
    return {"avail_mib": info["MemAvailable"], "swap_used_mib": info["SwapTotal"] - info["SwapFree"]}


def top_procs(n: int = 6) -> list[str]:
    out = sh(["ps", "-eo", "pcpu,comm", "--sort=-pcpu", "--no-headers"])
    return [" ".join(line.split()) for line in out.splitlines()[:n]]


def main() -> None:
    gov_path = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
    state = {
        "load_profile": os.environ.get("LOAD_PROFILE", "unset"),
        "cpu_busy_pct": cpu_busy(),
        "loadavg": os.getloadavg()[0],
        "governor": open(gov_path).read().strip() if os.path.exists(gov_path) else None,
        "gpu": gpu(),
        "mem": meminfo(),
        "top": top_procs(),
        "containers": sorted(sh(["docker", "ps", "--format", "{{.Names}}"]).split()),
    }
    print(json.dumps(state))


if __name__ == "__main__":
    main()
