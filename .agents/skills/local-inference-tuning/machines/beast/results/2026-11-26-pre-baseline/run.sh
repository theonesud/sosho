#!/usr/bin/env bash
set -euo pipefail
W=/home/sud/rustingstrata-bench
MDIR=/home/sud/sosho/models/Qwen3.6-35B-A3B-heretic
MF=Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-Q4_K_M.gguf
BIN=/home/sud/rustingstrata/target/release/rustingstrata
IMG=rustingstrata:v1.3.7
COMMON=(--gpu --ctx 65536 --kv q8 --vram-margin 512 --pp 512,4096,32768 --tg 128 --reps 3)
export STRATA_NO_UPDATE_CHECK=1
run_local() {
  XDG_CACHE_HOME=$W/cache-local "$BIN" bench --model "$MDIR/$MF" "${COMMON[@]}" "$@"
}
run_docker() {
  docker run --rm --gpus all --ipc host --ulimit memlock=-1 \
    -v "$MDIR":/models:ro -v $W/cache-docker:/cache \
    -v $W/results:/results "$IMG" bench --model /models/$MF "${COMMON[@]}" "$@"
}
for round in 1 2; do
  for mtp in 0 2; do
    for v in local docker; do
      tag=$v-mtp$mtp-r$round
      echo "== $tag $(date +%T) gpu=$(nvidia-smi --query-gpu=temperature.gpu,memory.used --format=csv,noheader)"
      if [ $v = local ]; then
        run_local --mtp $mtp --json-out $W/results/$tag.json 2>&1 | tee $W/results/$tag.log
      else
        run_docker --mtp $mtp --json-out /results/$tag.json 2>&1 | tee $W/results/$tag.log
      fi
    done
  done
done
