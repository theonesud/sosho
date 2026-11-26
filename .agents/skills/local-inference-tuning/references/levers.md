# Levers

Each lever has a prior: how often it helped before. "Evidence" gives known numbers. Measure every lever on this machine. A prior is not a result.

## 1. Memory placement (hybrid models)

| Lever | Prior | Evidence and notes |
|---|---|---|
| VRAM margin, or an explicit expert budget | Medium | Each freed 100 MB holds more experts. Too small a margin gives out-of-memory errors when the desktop grows. RustingStrata: 256 MB gave +1% to 2% prefill on a card with no display. 128 MB gave out of memory. |
| KV cache type | Two-sided | Quantized KV frees VRAM for experts. On models with few attention layers, KV is already small. llama.cpp q8_0 KV cut decode from 45.4 to 27.0 tok/s on such a model. RustingStrata q8 KV: -6% decode and -14% prefill at 32K. Lossy for q4 and below. |
| Expert placement policy | Medium | Hot experts in VRAM raise the hit rate `h`. Warm the routing profile with real prompts of the user. Tune the adapt interval and the number of swaps. |
| Per-layer expert budget | Unknown | Layers with a steep hotness curve gain more from VRAM slots. Code change. |
| Huge pages, prefetch, read-ahead | Low | Small gains on the CPU expert path. |

## 2. CPU expert path

| Lever | Prior | Evidence and notes |
|---|---|---|
| Thread count | High | Use physical cores only. SMT siblings add contention. RustingStrata: 6 threads beat 12 by about 20% on a 6-core CPU. Test cores minus 1 on a shared machine. |
| Core pinning and priority | Medium | See `environment.md` section 5. |
| Batched CPU kernels for verify rows | Medium | One read of an expert from RAM serves several draft rows. Code change. |
| Overlap of CPU and GPU work | Medium | Start the CPU experts as soon as the router finishes. Check whether the engine already does this. |

## 3. Speculative decoding

| Lever | Prior | Evidence and notes |
|---|---|---|
| Built-in MTP head, draft count | Two-sided | Our micro bench: MTP 2 gave +22% to 32% decode on prose. RustingStrata docs: drafts pay only when most experts are in VRAM. llama.cpp MTP was slower than no drafts with experts on the CPU. Depth beyond 1 is often weak. Measure on real prompts. |
| N-gram or suffix drafters | High for agents | Agents repeat code and file content. Lossless. Combine with MTP. |
| External draft model, for example DFlash2 | Unknown | The draft uses VRAM that experts would use. The verify block activates more experts. |
| Draft vocabulary shortlist | Medium | A pruned draft LM head gave +14% to 27%. The target still verifies with the full vocabulary. |
| Draft length per context depth | Medium | The best length drops at long context and at higher concurrency. |

## 4. Prefill and prompt cache

| Lever | Prior | Evidence and notes |
|---|---|---|
| Prefix cache on, and check that it hits | Very high for agents | Turn-2 time to first token fell from 36 s to 0.45 s at 66K. Hybrid linear-attention models need a state snapshot. Some engines turn the cache off for them. Check `cached_tokens` > 0. |
| Keep thinking blocks in the history | High for agents | A chat template that drops old thinking blocks changes the prefix each turn. That forces a full prefill. |
| Prefill chunk size | Medium | Larger chunks reuse expert copies better. Smaller chunks give shorter stalls. Calibrate it. |
| Host RAM cache for parked conversations | Medium | Agent side requests, for example a title or a summary, evict the main conversation. |

## 5. GPU kernels

| Lever | Prior | Evidence and notes |
|---|---|---|
| Per-card kernel settings: block size, rows per warp, split-K | Medium | Authors tune on their own card. Another SM count can need other values. Intel B70 thread retune: 48.5 to 56.9 tok/s. |
| Decode graphs | High where absent | 2x on several engines. Only the GPU part can be captured. |
| Kernel fusion under graphs | Low | Three attempts gave 0% elsewhere. Do it last. |
| Lower weight precision | Lossy | Out of scope unless the user allows a different quant. Ampere has no FP8 units. INT4 is better there. |

## 6. Evidence from campaign qwen36-35b-a3b-heretic-q4km__rustingstrata__beast (2026-11-26)

Hybrid MoE, 21.8 GB model on an 8 GB GPU, about 17% to 20% of experts resident, agent replay score.

| Lever | Result against its control | Lesson |
|---|---:|---|
| VRAM margin 512 to 256 MB, plus q8 KV | -5.2% | More resident experts. Small but real. |
| VRAM margin alone, q8 KV alone | -2.0%, -2.7% | Each one was below the bar. The combination passed. |
| CPU threads 6 to 5 | -0.7% quiet, +1.1% under stress | No gain. Keep physical cores. |
| MTP 1 and 2 drafts | +0.3% to +0.5% | Decode +8%, but prefill -6% to -7%. Agent turns are prefill-heavy. |
| Suffix and n-gram drafters | -0.1% | No gain on this replay. |
| Expert adaptation off | +16.6% | Decode falls from 69 to 48 tok/s. Never turn it off. |
| Short-prompt threshold 32 to 64 | inside noise | Few turns are under 64 new tokens. |
| Code: CPU runs missed experts with at most 8 rows in a prefill chunk, chunks up to 1,024 tokens (C12) | -7.6% | The largest lever. It removes most of the PCIe upload per agent turn. |

## 7. Order

1. Prompt cache and thinking history: check that they work. Then split the time per turn into prefill and decode, and fit `prompt_ms` against new tokens. A large fixed cost per request is the first target.
2. Threads, core pinning, and priority.
3. VRAM margin and KV type.
4. Speculative decoding: MTP count, then n-gram drafters, then external drafts.
5. Expert placement and adapt settings.
6. Prefill chunk and short-prompt threshold, by calibration.
7. Kernel settings.
8. Code changes, after a profile.
