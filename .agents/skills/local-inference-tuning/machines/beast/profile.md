# Machine: beast

Recorded 2026-11-26.

## Hardware

| Part | Value |
|---|---|
| GPU | NVIDIA GeForce RTX 3060 Ti, 8192 MiB, sm_86, 38 SMs, power limit 200 W |
| Driver | 595.99.02, CUDA 13.2 driver API. Host toolkit: CUDA 13.4 and 13.5. |
| PCIe | Gen 4 x16 under load, verified 2026-11-26. Gen 2 at idle. |
| CPU | Intel Core i5-12400F, 6 cores, 12 threads, 4.4 GHz max, AVX2 and FMA, no AVX-512, L2 7.5 MiB, L3 18 MiB, no iGPU |
| RAM | 46 GiB. Speed and channels: not verified. |
| Swap | 31 GiB |
| Disk | `/` 162 GB. Ran full during the campaign (72 MB free). About 27 GB free after the old Q5 model was deleted. |
| OS | Ubuntu 24.04.5, kernel 7.0.0-44 |
| Docker | 29.9.3, native engine with the NVIDIA runtime |
| Governor | `performance` |
| Transparent huge pages | `always` |

## Display

The RTX 3060 Ti drives the desktop. There is no iGPU. Xorg, gnome-shell, the hidamari video wallpaper, a browser, and the herdr terminal use about 0.6 to 1.3 GB of VRAM.

## Base load

Measured 2026-11-26, 14:10, with an IDE (Antigravity) open, Spotify playing, the herdr terminal, and Claude Code:

| Process | CPU |
|---|---|
| ClickHouse container (Langfuse stack) | 87% to 126%, about one core, also when idle |
| gnome-shell | 9% |
| Claude Code | 9% |
| herdr | 5% |
| hidamari wallpaper | 3% |
| Spotify, Xorg, LiteLLM, Postgres, other containers | about 1% each |

Total: about 10% of 12 threads busy, 88% idle. The ClickHouse load is the largest item. It lands on one core, so it can slow the CPU expert threads. The user keeps the container stack running during benchmarks.

## Containers that stay up

`engine`, `litellm`, `llama-cpp`, `sosho-postgres-1`, `sosho-redis-1`, `sosho-clickhouse-1`, `sosho-minio-1`, `sosho-langfuse-web-1`, `sosho-langfuse-worker-1`.

Stop `llama-cpp` during runs. It holds VRAM. Start it again after the run.

## Bandwidth

| Path | Value |
|---|---|
| GPU memory | 448 GB/s spec. Measured: not yet. |
| RAM read | not yet |
| PCIe host to device | not yet |

## Models on disk

- `/home/sud/sosho/models/Qwen3.6-35B-A3B-heretic/Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-Q4_K_M.gguf`, 21,780,313,248 bytes.
- The earlier Q5_K_P model was deleted on 2026-11-26.

## Events

- 2026-11-26: two mains power losses, at about 15:10 and 15:29. The second came while the GPU was idle. Power came back at 17:07.
- 2026-11-26: the disk ran full during batch 2. The ClickHouse container of the Langfuse stack grows its writable layer, 1.1 GB to 1.9 GB in one day.
- The old model `Qwen3.6-35B-A3B` Q5_K_P was deleted on 2026-11-26. The sosho `llama-cpp` presets still point to it.
