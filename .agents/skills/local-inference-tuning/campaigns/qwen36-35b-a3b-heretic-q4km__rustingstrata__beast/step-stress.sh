#!/usr/bin/env bash
# Shared-CPU step: the best config and its CPU variants under the `stress` load profile (1 busy core added).
set -u
S=$(cd "$(dirname "$0")/../.." && pwd); C=qwen36-35b-a3b-heretic-q4km__rustingstrata__beast
python3 -I $S/scripts/load_gen.py --procs 1 --duty 1.0 & LOAD=$!
trap 'kill $LOAD 2>/dev/null; wait $LOAD 2>/dev/null' EXIT
sleep 3
echo "== $(date +%T) load generator pid $LOAD"
LOAD_PROFILE=stress python3 -I $S/scripts/run.py --campaign $C queue c13-rows8-t1024 b0 d01-best-threads5 d02-best-pin5 c13-rows8-t1024 --profile quick
echo "== $(date +%T) STEP DONE"
