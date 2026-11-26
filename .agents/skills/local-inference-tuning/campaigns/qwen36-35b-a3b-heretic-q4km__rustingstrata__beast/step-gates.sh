#!/usr/bin/env bash
# Quality step: greedy outputs of B0 (twice), the best config, and llama.cpp; then the full profile of the best.
set -u
S=$(cd "$(dirname "$0")/../.." && pwd); C=qwen36-35b-a3b-heretic-q4km__rustingstrata__beast
M=Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-Q4_K_M
RUN="python3 -I $S/scripts/run.py --campaign $C"; GATE="python3 -I $S/scripts/gate_greedy.py"
export LOAD_PROFILE=quiet
echo "== $(date +%T) b0 greedy"
$RUN serve b0 && $GATE run --base-url http://127.0.0.1:8091 --campaign $C --model $M --out b0-a \
  && $GATE run --base-url http://127.0.0.1:8091 --campaign $C --model $M --out b0-b; $RUN stop
echo "== $(date +%T) best greedy"
$RUN serve c13-rows8-t1024 && $GATE run --base-url http://127.0.0.1:8091 --campaign $C --model $M --out best; $RUN stop
echo "== $(date +%T) llama.cpp greedy"
docker run -d --name lit-llama --gpus all -v /home/sud/sosho/models/Qwen3.6-35B-A3B-heretic:/models:ro \
  -p 127.0.0.1:8199:8080 ghcr.io/ggml-org/llama.cpp:server-cuda-b12407 \
  -m /models/$M.gguf --jinja -c 32768 -fa on --host 0.0.0.0 --port 8080 >/dev/null
for i in $(seq 1 180); do curl -sf http://127.0.0.1:8199/health >/dev/null && break; sleep 5; done
$GATE run --base-url http://127.0.0.1:8199 --campaign $C --model $M --out llama
docker logs lit-llama > $S/campaigns/$C/gates/llama-server.log 2>&1; docker stop -t 60 lit-llama >/dev/null; docker rm lit-llama >/dev/null
echo "== $(date +%T) best full profile"
$RUN queue c13-rows8-t1024 --profile full --roles candidate
docker start llama-cpp >/dev/null
echo "== $(date +%T) compare"
for o in b0-b best llama; do $GATE compare --campaign $C b0-a $o | tail -1; done
echo "== $(date +%T) STEP DONE"
