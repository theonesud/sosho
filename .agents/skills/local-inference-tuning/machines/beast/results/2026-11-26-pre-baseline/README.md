# Pre-baseline runs, 2026-11-26

These runs came before the skill existed. They are not B0. They are tuned: q8 KV, a calibration file, and MTP 0 or 2. They used `rustingstrata bench` with its built-in prose, which routes few experts. Use them as early data points only.

## Setup

- RustingStrata v1.3.7, built with Rust 1.100.0, `-C target-cpu=native`, NVRTC 13.5.
- Model: Heretic Q4_K_M, 21.8 GB.
- Flags: `--gpu --ctx 65536 --kv q8 --vram-margin 512 --pp 512,4096,32768 --tg 128 --reps 3`.
- Calibration (`calibration.json`): chunk 2048, MTP 1, short 32. Search took 7 min 19 s, 24 samples.
- Order: local, docker, local, docker, for MTP 0 and MTP 2. Two rounds, 3 reps each.
- Placement plan: weights, state, and scratch 2,432 MB, KV 680 MB at 65,536 tokens, expert slots 3,887 MB. 2,140 of 10,240 experts resident.
- `llama-cpp` container stopped during the runs. Desktop as normal.

## Result

See `baseline-summary.md`. Main facts:

1. Docker and the host build give the same speed. All differences are within ±1.5%.
2. MTP 0: decode 79.7 at 512, 76.3 at 4K, 66.8 at 32K. Prefill 1,151 at 4K and 1,120 at 32K.
3. MTP 2: decode +22% to +32%. Prefill -4%.

## Scripts

`run.sh` is the script that produced these numbers. It pointed at the old work folder `~/rustingstrata-bench`.
