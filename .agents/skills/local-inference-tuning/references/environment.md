# Environment

## 1. Why the environment matters

A hybrid MoE model runs part of its experts on the CPU. Each layer waits for the slowest CPU thread. One busy core can slow every token. On a laptop, a busy host CPU cut GPU decode from 107 to 75 tok/s. The GPU also often drives the desktop, which takes VRAM from the expert cache.

## 2. Machine profile

Write `machines/<host>/profile.md` with:

1. GPU: model, VRAM, driver, CUDA version, PCIe generation and width under load, power limit.
2. CPU: model, physical cores, SMT, ISA flags such as AVX2 and AVX-512, cache sizes, governor.
3. RAM: size, speed, channels. Write "not verified" if it needs root and the user did not give it.
4. Disk: free space on the model disk.
5. Display: which GPU drives it, and how much VRAM the desktop uses.
6. Base load: the apps and containers that run during normal work, with their CPU and memory share.
7. Measured bandwidth: GPU memory, RAM, and PCIe host-to-device.

NOTE: An idle GPU can lower its PCIe link speed to save power. Read the link generation while the GPU is under load.

## 3. Load profiles

| Profile | Use | Content |
|---|---|---|
| `quiet` | Hill-climb runs | Required containers only. Desktop open, no wallpaper video, no browser, no music. |
| `base` | Phase 5 qualification, and a check every 5 accepted levers | The user's normal work set, for example an IDE, a music player, a terminal with an agent, and the container stack. |
| `stress` | Robustness check | `base` plus a synthetic CPU load of 1 core, made with a reproducible tool. |

Rules:

1. Record the profile name in every ledger line.
2. Compare runs only inside the same profile.
3. A config that wins in `quiet` but loses more than 10% in `base` against B0 in `base` is not the best config. The user works while the model runs.

## 4. Noise control

1. Set the CPU governor to `performance` during the campaign. Record the value.
2. Stop other GPU jobs. Stop other inference servers that hold VRAM.
3. Check free VRAM and CPU use before each run. Write them in the ledger line.
4. Keep the model file in the page cache. Do not let swap grow during a run.
5. Use the same container flags for every run.

## 5. Shared CPU: adapting to free cores

The user wants the engine to use the CPU that is free and to leave room for other work. Test these levers in this order:

1. Fewer CPU expert threads than physical cores, for example 5 of 6. One free core absorbs desktop work and the engine's own spin threads.
2. Pin the engine to a fixed set of cores with the container `--cpuset-cpus` option. Leave the other cores to the desktop.
3. Lower the engine priority with `nice`, or use a CPU weight in the container. Then the desktop stays responsive, and the engine takes the idle cycles.
4. Code change: let the CPU expert path split work into small pieces that idle threads take. One slow thread then does not hold up the layer. Change the thread count when the measured system load changes.

Measure each lever in `quiet` and in `stress`. The best lever has the smallest loss in `stress` for a small loss in `quiet`.

## 6. When the user is away

The `base` profile needs the user's real apps and activity. If the user is away, run `stress` instead: `scripts/load_gen.py --procs 1 --duty 1.0` adds one busy core that the scheduler moves. It is harsher than normal desktop use. Record in the ledger that `base` did not run.

Result of the first campaign: one extra busy core cost the best config 0.7%. Fewer engine threads cost 1.1%, and pinning the engine away from core 0 cost 2.1%.
