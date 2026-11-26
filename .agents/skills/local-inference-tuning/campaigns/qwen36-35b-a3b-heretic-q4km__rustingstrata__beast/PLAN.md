# Campaign: Qwen3.6-35B-A3B Heretic Q4_K_M on RustingStrata, machine beast

## Inputs

| Item | Value |
|---|---|
| Model | `Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-Q4_K_M.gguf`, 21,780,313,248 bytes |
| Engine | RustingStrata v1.3.7, container `rustingstrata:v1.3.7`, `scripts/engines/rustingstrata/Dockerfile` |
| Machine | `machines/beast/profile.md` |
| Workload | 1 user, text only, thinking on, pi coding agent, context up to 64K |
| Sampling | temperature 0.6, top-p 0.95, top-k 20, min-p 0, presence 0, repeat 1.0. These are the owner's llama.cpp values. |

## B0

```
serve --gpu --ctx 65536 --addr 0.0.0.0:8080 --models-dir /models
```

The model loads on the first request. Empty `/cache` volume. No other flags or environment variables except `STRATA_NVRTC` and `STRATA_NO_UPDATE_CHECK=1`.

## Replay sessions

Primary source: the exact request bodies in Langfuse. The table is `events_full` in the `sosho-clickhouse-1` container, filtered on `provided_model_name = 'openai/Qwen3.6-35B-A3B'` and `type = 'GENERATION'`. Each row holds `input` with `messages` and `tools`, `output`, and `usage_details`. The calls have no session ID. Group them by a hash of the first two messages, and sort by `start_time`.

| ID | Langfuse group | Pi session file | Calls | Messages | Context | Note |
|---|---|---|---|---|---|---|
| S1 | `0bca8db5` | `2026-11-25T18-48-54-327Z_01a2140a-...jsonl` | 38 | 2 to 75 | 11.8K to 22.9K | Research and skill fixes |
| S2 | `fa44fc93` | `2026-11-25T18-40-36-659Z_01a21402-...jsonl` | 25 | 2 to 56 | to 20.8K | Research and tool debugging |
| S3 | not in Langfuse through LiteLLM | `2026-11-15T16-54-42-172Z_01a1e021-...jsonl` | 62 | - | to 46K | Debugging loop. Rebuild from the pi file with the S1 system prompt and tools. Optional. |
| W1 | about 300 single-call groups | - | 1 each | 1 to 14 | about 2K | Workflow LLM nodes. Short prompt, short output. Measures fixed overhead and short-prompt latency. |

The langfuse stack will be replaced by Arize Phoenix. Export the replay files to the campaign folder before that. Remove secrets from them.

### Facts from Langfuse, 2026-11-26

1. Pi sends `reasoning_content` back on every assistant message, with `tool_calls`. RustingStrata reads it (`src/chat.rs:190`). The prefix stays stable.
2. Pi sends `stream`, `stream_options.include_usage`, `max_completion_tokens 8192`, and `reasoning_effort medium`. Pi sends no sampling values. llama.cpp used its preset values. RustingStrata defaults to greedy. The replay and the later integration must send the sampling values.
3. In S1 under llama.cpp, the first call prefilled 11.8K tokens cold. Every later call hit the prefix cache: 12K to 13K cached tokens, 26 to 765 new tokens.
4. In S1, each call returned 57 to 195 output tokens: a short reasoning block and one tool call.
5. Over all 520 calls: prompt median 2,036 new tokens, output median 18 tokens, p90 113.

Effect on the lever order: an agent turn is a small prefill, a decode of about 100 tokens, and a fixed overhead per request. The cold first prefill is a large one-time cost. Prefix-cache levers come first, then short-decode levers, then prefill speed.

## Phases and status

| Phase | Task | Status |
|---|---|---|
| 0 | Skill folder, machine profile, engine notes | done |
| 0 | Engine image v1.3.7 | done |
| 1 | `scripts/export_langfuse.py`: replay files S1, S2, W1 in `replays/` | done, 0 redactions |
| 1 | `scripts/replay.py`: M3 | done, smoke-tested |
| 1 | `scripts/bench_server.py`: M2 and needle | done, smoke-tested |
| 1 | `scripts/run.py`: lock, container start and stop, environment snapshots, ledger | done, smoke-tested with `serve` |
| 1 | `scripts/env_check.py`: VRAM, CPU busy share, load profile, governor, PCIe link | done |
| 1 | M1 prompt file from a real session | to do, low priority |
| 2 | Bandwidth tests: GPU, RAM, PCIe under load | to do |
| 2 | Ceilings in the Theory section | to do |
| 3 | B0 in `quiet` and in `base` | to do |
| 3 | G0: parity against llama.cpp with the same model file, one time | to do |
| 3 | B0 reference outputs for G2 and G3 | to do |
| 4 | Hill-climb, list below | to do |
| 5 | Qualify in `base`, soak | to do |
| 6 | Serving command and report | to do |

## Lever list

Run in this order. Each lever is one config against the current best.

### Tier A: flags and environment variables

| ID | Lever | Values | Expected | Class |
|---|---|---|---|---|
| A01 | Prompt cache works | check `cached_tokens` per replay turn | Most of the agent gain | check |
| A02 | `--preserve-thinking` | true or false, after the pi check | Prefix stability | lossless |
| A03 | `--cache-ram` | 4096, 8192 | Side requests do not evict the main conversation | lossless |
| A04 | `--threads` | 6, 5, 4 | 5 can win on a shared CPU | lossless |
| A05 | Core pinning `--cpuset-cpus` and `nice` | engine on 5 cores, desktop on 1 | Robustness in `base` | lossless |
| A06 | `--vram-margin` | 512, 384, 256 | More expert slots | lossless |
| A07 | `--kv` | f16, q8 | q8 frees about 600 MB at 64K. Decode can drop. | lossy for q8 |
| A08 | `--mtp` | 0, 1, 2, 3 | Micro bench showed +22% to 32% at 2 | lossless |
| A09 | `STRATA_MTP_ADAPT`, `STRATA_MTP_FULL_VOCAB` | on or off | Small | lossless |
| A10 | `--spec-type` | `suffix`, `ngram-cache`, `ngram-mod`, combined with MTP | Large on repeated code and tool output | lossless |
| A11 | `--spec-draft-n-max`, n-gram sizes | from `calibrate spec` | Small to medium | lossless |
| A12 | DFlash2 draft `--draft-model` | block adaptive, then fixed | Unknown. Uses about 0.5 GB VRAM after conversion. | lossless |
| A13 | Routing profile warmed on replay sessions | cold or warm | Higher hit rate at start | lossless |
| A14 | `STRATA_ADAPT_EVERY`, `STRATA_ADAPT_SWAPS` | 8 to 32, 8 to 64 | Small to medium | lossless |
| A15 | `STRATA_PF_ADAPT` | 0, 1, 2 | Unknown, untested by the authors | lossless |
| A16 | `--chunk`, `--short` | from `calibrate` with `--ctx 65536` and the chosen KV | Prefill | lossless |
| A17 | `STRATA_MOE_PREFETCH`, `STRATA_HUGEPAGE` | on or off | Small | lossless |
| A18 | Kernel settings `STRATA_GEMV_BLOCK*`, `STRATA_RPW*`, `STRATA_MMQ`, `STRATA_GEMM_BK`, `STRATA_SMEM_CARVEOUT` | sweep | The 3060 Ti has 38 SMs. The authors tuned on 28. | numerics |
| A19 | `STRATA_VERIFY_GEMM`, `STRATA_BATCH_MIN` | sweep | Verify cost with drafts | numerics |

### Tier B: host and container

| ID | Lever | Note |
|---|---|---|
| B01 | Quiet desktop: no wallpaper video, no browser | Frees VRAM and CPU |
| B02 | PCIe link under load | If it stays below Gen 4, check the BIOS and the slot |
| B03 | RAM speed and XMP | Needs the user to check the BIOS, or `sudo dmidecode` |
| B04 | ClickHouse idle CPU | Outside the engine. Tune the Langfuse ClickHouse settings to cut idle merges. Ask the user first. |
| B05 | Container CPU weight and memory lock | `--cpu-shares`, `--ulimit memlock=-1` |

### Tier C: code changes on a fork of the engine

Do these only after a profile by stage. Each one needs G1, G2, and G3.

| ID | Lever | Source |
|---|---|---|
| C01 | Per-layer time profile: GPU, CPU experts, sync wait | first step |
| C02 | CPU expert kernel: batched Q4_K AVX2 rows for verify, register blocking | `local-ai-best.md` rung 2 |
| C03 | CPU work split into small pieces, so that a busy core does not hold the layer | user need: shared CPU |
| C04 | Thread count that follows the system load | user need: shared CPU |
| C05 | Per-layer expert budget from routing hotness | `local-ai-best.md` rung 3 |
| C06 | Eviction policy: frequency with decay and recency | `local-ai-best.md` rung 3 |
| C07 | Q4_K GEMV and small-batch kernels tuned for sm_86 | `local-ai-best.md` rung 4 |
| C08 | Decode graph capture for the GPU part of each layer, if absent | `local-ai-best.md` rung 5 |
| C09 | L2 persistence for shared experts, norms, and router | `local-ai-best.md` rung 5 |
| C10 | Memory lock of the expert arena, which the engine does not have now | `local-ai-best.md` rung 2 |
| C11 | Asymmetric KV, K8 and V4, only for a longer context | `local-ai-best.md` rung 6 |
| C12 | Single-request prefill: run missed experts on the CPU when a chunk routes few tokens to them, instead of uploading them over PCIe. The batch path already does this (`prefill.rs:640`). | batch 1 analysis. Largest expected gain: up to about 15% of the score. |
| C13 | Keep the KV of the decoded reply, so the next turn does not prefill the previous reply again | batch 1 analysis. Small. The replay cannot measure it, because it sends the recorded reply. |

## Batches

All batches use the `quick` profile and the `quiet` load profile unless noted.

| Batch | Queue | Purpose | Status |
|---|---|---|---|
| 1 | `b0 a04-threads5 a06-margin256 a07-kv-q8 a08-mtp1 a08-mtp2 a10-spec-suffix b0` | B0 quick score and noise, then screen 6 independent levers against B0 | done, 2026-11-26. Two power losses, resumed. |
| 2 | `b0 c01-margin256-kvq8 a20-adapt0 a21-short64 b0` | Attack the upload cost of small prefills. c01 combines the two unclear levers of batch 1. | done, 2026-11-26 |
| 3 | `c01 c12-rows0 c12-rows2 c12-rows4 c12-rows8 c12-rows16 c01` | Confirm c01 as the control. C12 sweep on the fork image, commit 20fbb58. | running |
| 2b | A03, A05, A09, A11, A13, A14, A16, A17 against the best | Remaining flag levers | to do |
| 3 | A12 DFlash2, A18 kernel settings, A19 | Levers that need a download or a sweep | to do |
| final | `b0` and the best config with the `full` profile, then the `base` load profile | Qualification and the B0 reference for the gates | to do |

## Theory

Fill in after phase 2.

## Experiments

Add one entry per run: time, config, change, numbers, verdict, reason.

### 2026-11-26 14:46, smoke test of the harness, B0, not in the ledger

- B0 start: healthy after 89.8 s. Plan: weights, state, and scratch 3,264 MB, KV 1,280 MB at f16, expert slots 3,088 MB, 1,700 of 10,240 experts resident. The engine warns that it is not calibrated.
- M3, S1 first 4 turns, 1 rep: replay 21.2 s, first turn 9.5 s cold, cache hit 74%, decode 55.5 tok/s.
- M2 quick: short time to first token 0.34 s, decode 61.6 tok/s on the panel, prefill 1,174 tok/s at 4K.
- Needle at 4K: 3 of 3.
- Desktop as normal, not `quiet`. These numbers are not B0 results.
- The model ID in requests has no `.gguf` suffix.

### 2026-11-26 15:12 to 17:36, batch 1, quick profile, quiet

Two mains power losses: at about 15:10 during a04 M2 (attempt 1, void), and at about 15:29 after a06 had stopped (GPU idle). The batch resumed at 17:09 with a07. Controls: b0 at 15:12 and at 17:31.

| Config | S1 s | W1 s | Score s | vs B0 mean | M2 decode | pp4096 | pp32768 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| b0 (start) | 152.3 | 40.2 | 192.50 | - | 68.3 | 1,211 | 1,389 | control |
| a04-threads5 | 152.6 | 39.5 | 192.16 | -0.7% | 69.3 | 1,238 | 1,394 | reject, inside noise. Keep for the `stress` test. |
| a06-margin256 | 149.8 | 39.8 | 189.63 | -2.0% | 71.8 | 1,219 | 1,392 | unclear. 2,050 experts resident, B0 has 1,700. |
| a07-kv-q8 | 148.6 | 39.7 | 188.30 | -2.7% | 72.3 | 1,222 | 1,370 | unclear. Lossy: needs G4. |
| a08-mtp1 | 150.9 | 42.2 | 193.13 | -0.2% | 69.3 | 1,135 | 1,304 | reject. Replay decode 64.7, but prefill -6%. |
| a08-mtp2 | 151.7 | 42.7 | 194.41 | +0.5% | 71.5 | 1,126 | 1,290 | reject. Prefill -7%. |
| a10-spec-suffix | 152.2 | 41.2 | 193.33 | -0.1% | 64.7 | 1,174 | 1,351 | reject |
| b0 (end) | 153.7 | 40.8 | 194.42 | - | 68.9 | 1,207 | 1,366 | control |

B0 mean 193.46 s. Noise 1.0%. Keep bar 3%. No lever passed. a06 and a07 are unclear: run them again, and their combination, in batch 2.

The cache hit on S1 is 95.5% for every config. W1 hit is 0%: the engine reuses the cache only for a continued conversation, not for a shared system prompt.

#### Where the B0 time goes, S1

- Decode part 84.8 s, 55%. Time to first token 68.9 s, 45%.
- First turn: 11,807 new tokens, 8.9 s.
- Later turns: median 225 new tokens, median 1.48 s. Server `prompt_ms` fits about 0.9 s fixed plus 1.4 ms per new token.
- The fixed cost is about 33 s of S1 and 9 s of W1: about 21% of the score. It is the largest target found. The cause is under study.

#### Cause of the fixed cost, from the code (not measured)

- For a single request, chunked prefill uploads every non-resident expert that any token in the chunk routes to, over PCIe (`src/gpu_model/prefill.rs:637-725`). The CPU never runs experts in this path. It does so only in the `--parallel` batch path.
- 100 to 800 new tokens touch 150 to 256 experts per layer. With about 43 resident experts per layer, that is about 9 to 13 GB per request. At 10 to 13 GB/s, this is 0.8 to 1.2 s, which matches the 0.9 s fixed cost.
- After the prefill, `settle` swaps hot experts into VRAM with no cap (`src/expert_cache.rs:232`). Estimated 0.05 to 0.3 s.
- Prompts under `--short` tokens (default 32) use the decode path: no upload, about 16 ms per token. Break-even is about 60 tokens.
- Facts: PCIe runs at Gen 4 x16 under load. About 37 GB of RAM stays available. The engine keeps the whole model in the page cache.

### 2026-11-26 17:48 to 18:15, batch 2, quick profile, quiet

| Config | S1 s | W1 s | Score s | vs B0 pooled mean | M2 decode | pp4096 | pp32768 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| b0 (start) | 154.0 | 41.1 | 195.12 | - | 69.3 | 1,197 | 1,362 | control |
| c01-margin256-kvq8 | 145.9 | 38.3 | 184.21 | -4.4% | 75.4 | 1,236 | 1,393 | keep, to be confirmed as the next control. Lossy: needs G4. |
| a20-adapt0 | 182.5 | 42.2 | 224.67 | +16.6% | 48.2 | 1,235 | 1,370 | reject. Decode falls from 69 to 48 tok/s without adaptation. |
| a21-short64 | 149.2 | 39.7 | 188.98 | -1.9% | 72.2 | 1,223 | 1,398 | reject. Inside the B0 range. |
| b0 (end) | 148.9 | 39.4 | 188.30 | - | 71.7 | 1,247 | 1,398 | control |

The two controls of this batch differ by 3.5%. Two controls are too few to measure the noise. All four B0 runs so far: 192.50, 194.42, 195.12, 188.30. Pooled mean 192.6 s, standard deviation about 1.5%. c01 is below every B0 run.

Method change: judge a candidate against the pooled mean and spread of all control runs of the same config under the same load profile. Do not judge it against the two controls of its batch only.

### 2026-11-26 18:35 to 19:11, batch 3, quick profile, quiet

| Config | S1 s | W1 s | Score s | vs c01 mean | M2 decode | pp4096 | pp32768 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| c01 (start) | 143.0 | 38.4 | 181.39 | - | 74.3 | 1,262 | 1,401 | control |
| c12-rows0 | 142.9 | 38.6 | 181.56 | -0.5% | 74.9 | 1,261 | 1,405 | fork with the split off equals c01 |
| c12-rows2 | 134.6 | 40.6 | 175.19 | -4.0% | 74.2 | 1,237 | 1,286 | pass, but pp32768 -8% |
| c12-rows4 | 130.0 | 39.9 | 169.92 | -6.9% | 75.6 | 1,236 | 1,294 | pass, but pp32768 -8% |
| c12-rows8 | 130.3 | 39.0 | 169.29 | -7.2% | 76.1 | 1,260 | 1,309 | best. pp32768 -7%. |
| c12-rows16 | 135.5 | 40.9 | 176.34 | -3.4% | 76.6 | 1,234 | 1,296 | worse than rows 4 and 8 |
| c01 (end) | 143.8 | 38.2 | 181.97 | - | 77.2 | 1,264 | 1,405 | control |

c01 runs: 184.21, 181.39, 181.97. Mean 182.5 s, spread under 1%. c01 is confirmed: -5.2% against the B0 mean of 192.6 s.

C12 with 4 to 8 rows gives -7% against c01 and about -12% against B0. The cold 32K prefill loses 7% to 8%, which is more than the M2 limit of 5%. Batch 4 limits the split to small chunks.

### 2026-11-26 19:14 to 19:39, batch 4, quick profile, quiet

| Config | S1 s | W1 s | Score s | M2 decode | pp4096 | pp32768 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| c13-rows8-t0 (start) | 130.2 | 39.2 | 169.39 | 72.9 | 1,265 | 1,313 | control, equals c12-rows8 |
| c13-rows8-t512 | 130.5 | 38.2 | 168.72 | 76.8 | 1,334 | 1,408 | large-prompt loss gone |
| c13-rows8-t1024 | 130.8 | 37.8 | 168.60 | 74.3 | 1,346 | 1,418 | best. Chosen. |
| c13-rows8-t2048 | 129.1 | 38.1 | 167.20 | 74.6 | 1,350 | 1,410 | same within noise |
| c13-rows8-t0 (end) | 130.2 | 39.3 | 169.46 | 77.5 | 1,262 | 1,312 | control |

The token limit removes the cold-prefill loss and keeps the agent gain. The 4K prefill is faster than c01: the 4K test prompt is one full chunk plus a small remainder chunk, and the CPU now runs the remainder. Not verified.

## Best so far: c13-rows8-t1024

Image `rustingstrata:c12b` (fork commit efdd548). Flags: `--gpu --ctx 65536 --vram-margin 256 --kv q8`. Environment: `STRATA_CPU_PF_ROWS=8`, `STRATA_CPU_PF_MAX_TOKENS=1024`.

| Measure | B0 mean | Best | Change |
|---|---:|---:|---:|
| Quick score | 192.6 s | 168.6 s | -12.5% |
| S1 | 151.8 s | 130.8 s | -14% |
| W1 | 40.3 s | 37.8 s | -6% |
| M2 decode | 69.5 tok/s | 74.3 tok/s | +7% |
| pp4096 | 1,215 tok/s | 1,346 tok/s | +11% |
| pp32768 | 1,379 tok/s | 1,418 tok/s | +3% |

Open: quality gates (q8 KV is lossy, the CPU path changes the arithmetic), and the shared-CPU test.

### 2026-11-26 20:02 to 20:18, quality step, quiet

Greedy outputs of 12 fixed prompts, 64 tokens each: 6 panel prompts, 4 S1 turns at 11.8K to 23.1K context with tools, 2 W1 calls. Compared by the first differing character. A prompt "agrees" if the shared prefix is at least half the text or 120 characters.

| Comparison | Agree | Mean share | Note |
|---|---:|---:|---|
| B0 run A against B0 run B | 9 of 12 | 0.814 | noise floor: expert placement changes the arithmetic order between runs |
| B0 against the best config (G2) | 9 of 12 | 0.795 | pass: same as the noise floor |
| B0 against llama.cpp b12407, same GGUF (G0) | 8 of 12 | 0.713 | partial pass: same prompt token counts, panel identical, agent turns split at the same near-ties as B0 itself |

Full profile of the best config (G3 and numbers): needle 3 of 3 at 50% and at 100% of the context. S1 129.9 s, S2 82.6 s, W1 (40 calls) 137.7 s. M2: decode 79.3 tok/s, short time to first token 0.27 s, pp4096 1,411, pp32768 1,422.

Not done: the token-by-token parity tool (`tools/parity.py`), and a KL divergence measure of q8 KV (G4). The greedy agreement at 23K context shows no loss from q8 KV beyond the noise floor.

### 2026-11-26 20:26 to 20:51, shared-CPU step, load profile `stress`

`stress` = idle desktop, the containers (ClickHouse uses about 1 core), and `scripts/load_gen.py --procs 1 --duty 1.0` (1 more busy core, not pinned). The user was away, so the `base` profile did not run.

| Config | S1 s | W1 s | Score s | vs best mean | M2 decode | pp4096 | pp32768 |
|---|---:|---:|---:|---:|---:|---:|---:|
| c13-rows8-t1024 (start) | 131.4 | 37.8 | 169.23 | - | 76.9 | 1,369 | 1,419 |
| b0 | 152.2 | 40.5 | 192.76 | +13.5% | 70.3 | 1,214 | 1,386 |
| d01-best-threads5 | 133.1 | 38.5 | 171.63 | +1.1% | 73.6 | 1,350 | 1,410 |
| d02-best-pin5 (CPUs 2-11) | 134.6 | 38.7 | 173.36 | +2.1% | 75.2 | 1,341 | 1,409 |
| c13-rows8-t1024 (end) | 131.9 | 38.5 | 170.45 | - | 73.9 | 1,349 | 1,411 |

Results:

1. One extra busy core costs the best config about 0.7% (169.8 s against 168.6 s quiet). B0 is unchanged (192.8 s against 192.6 s). The gain holds under load: the best config is 11.9% faster than B0.
2. Fewer engine threads cost speed: 5 threads +1.1%, 5 threads pinned away from core 0 +2.1%. Keep 6 threads as the default. Use `d01` if the desktop feels slow while the model runs. This test measures the engine only, not desktop responsiveness.

### 2026-11-26 21:20, llama.cpp yardstick, not measured

`configs/y01-llamacpp-tuned.json` holds the owner's tuned llama.cpp preset on the same GGUF. The container exited at start with an empty log. The cause was not found: a likely suspect is `--mlock` under the non-root `--user`. The owner stopped the yardstick and chose RustingStrata. The speed of this setup against llama.cpp on this machine is not measured.

## Outcome

Best config: `best-config.json` (c13-rows8-t1024). 12.5% faster than B0 quiet, 11.9% under `stress`. Gates G2 and G3 pass, G0 partial. Next: replace the `local-uncensored` llama.cpp backend in sosho with this config.

