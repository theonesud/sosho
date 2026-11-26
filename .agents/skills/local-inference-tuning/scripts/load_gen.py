#!/usr/bin/env python3
"""Synthetic CPU load for the `stress` load profile.

  load_gen.py --procs 1 --duty 1.0

Each process spins for `duty` of every 100 ms window and sleeps for the rest.
The processes are not pinned: the scheduler moves them, the way desktop work moves.
Stop with SIGTERM to the parent.
"""

import argparse
import multiprocessing as mp
import signal
import sys
import time


def spin(duty: float) -> None:
    window = 0.1
    while True:
        end = time.perf_counter() + window * duty
        x = 0
        while time.perf_counter() < end:
            x += 1
        if duty < 1.0:
            time.sleep(window * (1 - duty))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--procs", type=int, default=1)
    ap.add_argument("--duty", type=float, default=1.0)
    a = ap.parse_args()
    procs = [mp.Process(target=spin, args=(a.duty,), daemon=True) for _ in range(a.procs)]
    for p in procs:
        p.start()

    def stop(*_: object) -> None:
        for p in procs:
            p.terminate()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for p in procs:
        p.join()


if __name__ == "__main__":
    main()
